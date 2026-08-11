import { jsonSchema, tool, type ToolSet } from "ai"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import {
  buildSessionToolRuntimePlan,
  type AiSearchSessionTool,
  type PullRequest,
  type SessionToolSpec,
} from "@solzero/shared"
import { runAiSearchMcpTool, type AiSearchMcpRuntimeContext } from "../../mcp/ai-search-runtime"
import {
  getWorkflowBuilderCatalog,
  submitWorkflowBuilderDraft,
  validateWorkflowBuilderManifest,
} from "../../mcp/workflow-builder/runtime"
import { AiSearchRegistryStore, AiSearchSourceUnavailableError } from "../db/ai-search"
import {
  BackgroundTracing,
  makeBackgroundTracingLayer,
  type CloudflareTracing,
} from "../observability/tracing"
import type { Env } from "../types"

const DEFAULT_GLOB_PATTERN = "**/*"

type ValidationResult<T> =
  | {
      readonly success: true
      readonly value: T
    }
  | {
      readonly success: false
      readonly error: Error
    }

const NonEmptyString = Schema.NonEmptyString
const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const RepositoryFileLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(500))
const SearchResultLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(100))
const GitLogDepth = PositiveInt.check(Schema.isLessThanOrEqualTo(50))

class EmptyToolInput extends Schema.Class<EmptyToolInput>("EmptyToolInput")({}) {}

class ReadFileToolInput extends Schema.Class<ReadFileToolInput>("ReadFileToolInput")({
  path: NonEmptyString,
}) {}

class WriteFileToolInput extends Schema.Class<WriteFileToolInput>("WriteFileToolInput")({
  path: NonEmptyString,
  content: Schema.String,
}) {}

class GlobFilesToolInput extends Schema.Class<GlobFilesToolInput>("GlobFilesToolInput")({
  pattern: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(RepositoryFileLimit),
}) {}

class SearchFilesToolInput extends Schema.Class<SearchFilesToolInput>("SearchFilesToolInput")({
  query: NonEmptyString,
  pattern: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(SearchResultLimit),
}) {}

class GitLogToolInput extends Schema.Class<GitLogToolInput>("GitLogToolInput")({
  depth: Schema.optionalKey(GitLogDepth),
}) {}

class GitCreatePullRequestToolInput extends Schema.Class<GitCreatePullRequestToolInput>(
  "GitCreatePullRequestToolInput",
)({
  title: NonEmptyString,
  body: Schema.optionalKey(Schema.String),
  commitMessage: Schema.optionalKey(Schema.String),
}) {}

class DocsSearchToolInput extends Schema.Class<DocsSearchToolInput>("DocsSearchToolInput")({
  query: NonEmptyString,
}) {}

class WorkflowManifestToolInput extends Schema.Class<WorkflowManifestToolInput>(
  "WorkflowManifestToolInput",
)({
  manifest: Schema.Unknown,
}) {}

function inputSchema<S extends Schema.Decoder<unknown, never>>(schema: S) {
  const validate = (value: unknown): ValidationResult<S["Type"]> =>
    Schema.decodeUnknownResult(schema)(value).pipe(
      Result.match({
        onSuccess: (value) => ({ success: true, value }),
        onFailure: (error) => ({
          success: false,
          error: Match.value(error).pipe(
            Match.when(Match.instanceOf(Error), (resolved) => resolved),
            Match.orElse((resolved) => new Error(String(resolved))),
          ),
        }),
      }),
    )

  return jsonSchema<S["Type"]>(
    Schema.toStandardJSONSchemaV1(schema)["~standard"].jsonSchema.input({
      target: "draft-07",
    }),
    { validate },
  )
}

export interface IsolateWorkspaceRuntime {
  readWorkspaceFile(sessionId: string, path: string): Promise<{ path: string; content: string }>
  writeWorkspaceFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<{ path: string; bytes: number }>
  globWorkspace(sessionId: string, pattern?: string, limit?: number): Promise<string[]>
  searchWorkspace(
    sessionId: string,
    query: string,
    pattern?: string,
    limit?: number,
  ): Promise<Array<{ path: string; excerpt: string }>>
  gitStatus(sessionId: string): Promise<Array<{ filepath: string; status: string }>>
  gitDiff(sessionId: string): Promise<Array<{ filepath: string; status: string }>>
  gitLog(sessionId: string, depth?: number): Promise<Array<{ oid: string; message: string }>>
  gitCreatePullRequest(
    sessionId: string,
    input: {
      title: string
      body?: string
      commitMessage?: string
    },
  ): Promise<PullRequest>
}

export interface IsolateToolContext {
  env: Env
  runtime: IsolateWorkspaceRuntime
  sessionId: string
  userId: string
  selectedTools: SessionToolSpec[]
  docsRuntimeContext: AiSearchMcpRuntimeContext
  tracing?: CloudflareTracing
}

function runIsolateTool<A, E>(
  context: IsolateToolContext,
  toolName: string,
  attributes: Record<string, unknown>,
  // oxlint-disable-next-line s0-lint/no-manual-effect-channels -- Generic span runner: the `Effect<A, E>` parameter channel is intrinsic to forwarding the caller's tool effect into BackgroundTracing.
  run: Effect.Effect<A, E>,
) {
  return Effect.gen(function* () {
    const backgroundTracing = yield* BackgroundTracing
    return yield* backgroundTracing.withSpan(
      `isolate.tool.${toolName}`,
      {
        "session.id": context.sessionId,
        "user.id": context.userId,
        "tool.name": toolName,
        ...attributes,
      },
      run,
    )
  }).pipe(Effect.provide(makeBackgroundTracingLayer({ tracing: context.tracing })))
}

function aiSearchSourceSearchEffect(
  context: IsolateToolContext,
  aiSearchTool: AiSearchSessionTool,
  query: string,
) {
  return runIsolateTool(
    context,
    "docs_search.source",
    { "ai_search.source_id": aiSearchTool.sourceId },
    Effect.gen(function* () {
      const sources = yield* new AiSearchRegistryStore(context.env).listAvailableSourcesByIds([
        aiSearchTool.sourceId,
      ])
      const source = yield* Effect.fromOption(Option.fromNullishOr(sources[0])).pipe(
        Effect.catch(() =>
          Effect.fail(new AiSearchSourceUnavailableError({ sourceIds: [aiSearchTool.sourceId] })),
        ),
      )
      const result = yield* runAiSearchMcpTool(
        context.env,
        source,
        query,
        context.docsRuntimeContext,
        "search",
      )
      return { sourceId: source.id, result }
    }),
  )
}

export function buildIsolateTools(context: IsolateToolContext): ToolSet {
  const internalToolSpecs = context.selectedTools.filter((spec) => spec.kind !== "mcpcf_server")
  const plan = buildSessionToolRuntimePlan({ tools: internalToolSpecs })
  const { aiSearchTools, repoTool, workflowBuilderEnabled } = plan.isolateAiSdkTools

  const repoTools = Match.value(Boolean(repoTool)).pipe(
    Match.when(false, (): ToolSet => ({})),
    Match.orElse(
      (): ToolSet => ({
        read_file: tool({
          description: "Read a file from the attached repository workspace.",
          inputSchema: inputSchema(ReadFileToolInput),
          execute: ({ path }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "read_file",
                { "file.path": path },
                Effect.tryPromise({
                  try: () => context.runtime.readWorkspaceFile(context.sessionId, path),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        write_file: tool({
          description: "Write a file in the attached repository workspace.",
          inputSchema: inputSchema(WriteFileToolInput),
          execute: ({ path, content }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "write_file",
                { "file.path": path, "file.content_length": content.length },
                Effect.tryPromise({
                  try: () => context.runtime.writeWorkspaceFile(context.sessionId, path, content),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        glob_files: tool({
          description: "List files from the attached repository workspace using a glob pattern.",
          inputSchema: inputSchema(GlobFilesToolInput),
          execute: ({ pattern, limit }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "glob_files",
                {
                  "file.pattern": pattern ?? DEFAULT_GLOB_PATTERN,
                  "result.limit": limit ?? "",
                },
                Effect.tryPromise({
                  try: () =>
                    context.runtime.globWorkspace(
                      context.sessionId,
                      pattern ?? DEFAULT_GLOB_PATTERN,
                      limit,
                    ),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        search_files: tool({
          description: "Search repository files for text matches and return short excerpts.",
          inputSchema: inputSchema(SearchFilesToolInput),
          execute: ({ query, pattern, limit }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "search_files",
                {
                  "search.query_length": query.length,
                  "file.pattern": pattern ?? DEFAULT_GLOB_PATTERN,
                  "result.limit": limit ?? "",
                },
                Effect.tryPromise({
                  try: () =>
                    context.runtime.searchWorkspace(
                      context.sessionId,
                      query,
                      pattern ?? DEFAULT_GLOB_PATTERN,
                      limit,
                    ),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        git_status: tool({
          description: "Get git status for the attached repository workspace.",
          inputSchema: inputSchema(EmptyToolInput),
          execute: () =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "git_status",
                {},
                Effect.tryPromise({
                  try: () => context.runtime.gitStatus(context.sessionId),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        git_diff: tool({
          description: "Get changed files from git diff for the attached repository workspace.",
          inputSchema: inputSchema(EmptyToolInput),
          execute: () =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "git_diff",
                {},
                Effect.tryPromise({
                  try: () => context.runtime.gitDiff(context.sessionId),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        git_log: tool({
          description: "Get recent git commits from the attached repository workspace.",
          inputSchema: inputSchema(GitLogToolInput),
          execute: ({ depth }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "git_log",
                { "git.log_depth": depth ?? "" },
                Effect.tryPromise({
                  try: () => context.runtime.gitLog(context.sessionId, depth),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        git_create_pull_request: tool({
          description:
            "Commit all current workspace changes, push the s0-managed branch, and create a GitHub pull request against the repository default branch.",
          inputSchema: inputSchema(GitCreatePullRequestToolInput),
          execute: ({ title, body, commitMessage }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "git_create_pull_request",
                {
                  "pull_request.title_length": title.length,
                  "pull_request.body_length": body?.length ?? 0,
                  "git.commit_message_present": Boolean(commitMessage?.trim()),
                },
                Effect.tryPromise({
                  try: () =>
                    context.runtime.gitCreatePullRequest(context.sessionId, {
                      title,
                      body,
                      commitMessage,
                    }),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
      }),
    ),
  )

  const docsToolSet = Match.value(aiSearchTools.length > 0).pipe(
    Match.when(false, (): ToolSet => ({})),
    Match.orElse(
      (): ToolSet => ({
        docs_search: tool({
          description:
            "Search the configured internal knowledge sources available to this isolate session.",
          inputSchema: inputSchema(DocsSearchToolInput),
          execute: ({ query }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "docs_search",
                {
                  "search.query_length": query.length,
                  "ai_search.source_count": aiSearchTools.length,
                },
                Effect.all(
                  aiSearchTools.map((toolSpec) =>
                    aiSearchSourceSearchEffect(context, toolSpec, query),
                  ),
                  { concurrency: "unbounded" },
                ),
              ),
            ),
        }),
      }),
    ),
  )

  const workflowTools = Match.value(workflowBuilderEnabled).pipe(
    Match.when(false, (): ToolSet => ({})),
    Match.orElse(
      (): ToolSet => ({
        get_workflow_node_catalog: tool({
          description:
            "Return the workflow node catalog, port definitions, and bundled workflow templates.",
          inputSchema: inputSchema(EmptyToolInput),
          execute: () =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "get_workflow_node_catalog",
                {},
                Effect.try({
                  try: () => getWorkflowBuilderCatalog(),
                  catch: (cause) => cause,
                }),
              ),
            ),
        }),
        validate_workflow_manifest: tool({
          description:
            "Validate a workflow manifest draft and return errors, warnings, execution order, and the normalized manifest.",
          inputSchema: inputSchema(WorkflowManifestToolInput),
          execute: ({ manifest }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "validate_workflow_manifest",
                {
                  "workflow.manifest_present": manifest !== undefined && manifest !== null,
                },
                validateWorkflowBuilderManifest({ manifest }),
              ),
            ),
        }),
        submit_workflow_draft: tool({
          description:
            "Submit the final workflow manifest draft after validation. The UI will load this draft for user review before saving.",
          inputSchema: inputSchema(WorkflowManifestToolInput),
          execute: ({ manifest }) =>
            // oxlint-disable-next-line effect/effect-run-in-body -- AI SDK tool.execute requires a Promise; runs the tool span Effect at that boundary.
            Effect.runPromise(
              runIsolateTool(
                context,
                "submit_workflow_draft",
                {
                  "workflow.manifest_present": manifest !== undefined && manifest !== null,
                },
                submitWorkflowBuilderDraft(
                  {
                    env: context.env,
                    sessionId: context.sessionId,
                    userId: context.userId,
                  },
                  { manifest },
                ),
              ),
            ),
        }),
      }),
    ),
  )

  return {
    ...repoTools,
    ...docsToolSet,
    ...workflowTools,
  }
}
