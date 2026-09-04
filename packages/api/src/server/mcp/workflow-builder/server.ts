import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { createSessionIndexStoreFromD1 } from "../../background/db/session-index"
import { makeControlPlaneFromEnv } from "../../effect/db/control-plane-db"
import { raise } from "../../lib/effect-errors"
import {
  INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE,
  WORKFLOW_BUILDER_SESSION_HEADER,
} from "../../background/session/mcp-config"
import type { Env } from "../../background/types"
import { WorkflowManifestDraftSchema } from "@solzero/shared"
import {
  getWorkflowBuilderCatalog,
  submitWorkflowBuilderDraft,
  validateWorkflowBuilderManifest,
  type WorkflowBuilderContext,
} from "./runtime"
import { objectInputSchema } from "../tool-input-schema"

const EmptyInputSchema: Tool["inputSchema"] = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
}

class WorkflowManifestInput extends Schema.Class<WorkflowManifestInput>("WorkflowManifestInput")({
  manifest: WorkflowManifestDraftSchema,
}) {}

const WorkflowManifestInputSchema = objectInputSchema(WorkflowManifestInput)

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        // oxlint-disable-next-line effect/avoid-direct-json -- pretty-printed (2-space) JSON tool output must be preserved exactly; lib/json stringifyJson emits compact JSON, which would change the MCP tool response text.
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

function rewriteRequestPathname(request: Request, url: URL, pathname: string): Request {
  url.pathname = pathname
  return new Request(url.toString(), request)
}

export function normalizeWorkflowBuilderMcpRequest(request: Request): Request {
  const url = new URL(request.url)
  return Match.value(url.pathname === `${INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE}/`).pipe(
    Match.when(true, () =>
      rewriteRequestPathname(request, url, INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE),
    ),
    Match.orElse(() => request),
  )
}

export async function resolveWorkflowBuilderContext(
  request: Request,
  env: Env,
): Promise<WorkflowBuilderContext> {
  const sessionId = Option.getOrThrowWith(
    Option.fromNullishOr(request.headers.get(WORKFLOW_BUILDER_SESSION_HEADER)?.trim()).pipe(
      Option.filter((value) => value.length > 0),
    ),
    () => new Error("Workflow builder MCP requests require a session id"),
  )

  const session = await createSessionIndexStoreFromD1(makeControlPlaneFromEnv(env)).getById(
    sessionId,
  )
  const resolved = Option.getOrThrowWith(
    Option.fromNullishOr(session),
    () => new Error("Workflow builder MCP session was not found"),
  )
  return {
    env,
    sessionId,
    userId: resolved.user_id,
  }
}

export function createWorkflowBuilderMcpServer(context: WorkflowBuilderContext): McpServer {
  const server = new McpServer(
    {
      name: "s0-workflow-builder",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: workflowBuilderTools,
  }))

  server.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callWorkflowBuilderTool(context, request.params.name, request.params.arguments ?? {}),
  )

  return server
}

const workflowBuilderTools = [
  {
    name: "get_workflow_node_catalog",
    description:
      "Return the workflow node catalog, port definitions, and bundled workflow templates. Template values must use connected target handles as {{inputs.<targetHandle>}}; {{nodes.*}} and {{trigger.*}} templates are rejected.",
    inputSchema: EmptyInputSchema,
  },
  {
    name: "validate_workflow_manifest",
    description:
      "Validate a workflow manifest draft and return errors, warnings, execution order, and the normalized manifest.",
    inputSchema: WorkflowManifestInputSchema,
  },
  {
    name: "submit_workflow_draft",
    description:
      "Submit the final workflow manifest draft after validation. The UI will load this draft for user review before saving.",
    inputSchema: WorkflowManifestInputSchema,
  },
] satisfies Tool[]

async function callWorkflowBuilderTool(
  context: WorkflowBuilderContext,
  name: string,
  rawInput: unknown,
): Promise<CallToolResult> {
  return Match.value(name).pipe(
    Match.when("get_workflow_node_catalog", () =>
      Promise.resolve(jsonToolResult(getWorkflowBuilderCatalog())),
    ),
    Match.when("validate_workflow_manifest", () =>
      runValidateWorkflowManifest(
        Schema.decodeUnknownSync(WorkflowManifestInput)(rawInput).manifest,
      ),
    ),
    Match.when("submit_workflow_draft", () =>
      runSubmitWorkflowDraft(
        context,
        Schema.decodeUnknownSync(WorkflowManifestInput)(rawInput).manifest,
      ),
    ),
    Match.orElse(() => raise(`Tool ${name} not found`)),
  )
}

async function runValidateWorkflowManifest(manifest: unknown): Promise<CallToolResult> {
  // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request handler requires Promise; runs validateWorkflowBuilderManifest Effect at that boundary.
  return Effect.runPromise(
    validateWorkflowBuilderManifest({ manifest }).pipe(Effect.map(jsonToolResult)),
  )
}

async function runSubmitWorkflowDraft(
  context: WorkflowBuilderContext,
  manifest: unknown,
): Promise<CallToolResult> {
  // oxlint-disable-next-line effect/effect-run-in-body -- MCP SDK request handler requires Promise; runs submitWorkflowBuilderDraft Effect at that boundary.
  return Effect.runPromise(
    submitWorkflowBuilderDraft(context, { manifest }).pipe(Effect.map(jsonToolResult)),
  )
}
