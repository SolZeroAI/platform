/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/no-ternary, s0-lint/prefer-option-over-null, effect/effect-run-in-body -- Worker entrypoint and container outbound handlers are imperative runtime boundaries around Effect-based services. */
import { WorkerEntrypoint, tracing } from "cloudflare:workers"
import { Container, ContainerProxy, type OutboundHandler } from "@cloudflare/containers"
import { getStageMetadataSync } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  createBetterAuth,
  cron,
  effectApiHandler,
  getAuthProviderRegistry,
  getPublicAuthProviderRegistry,
  reconcileManagedAdminCredentials,
  handleAiSearchMcpRequest,
  handleMcpcfMcpRequest,
  handleSessionWebSocketRequest,
  handleWorkflowBuilderMcpRequest,
  MCPCF_PROXY_MCP_ROUTE,
  INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE,
  IsolateSessionAgent,
  IsolateSubAgent,
  makeCloudflareContext,
  normalizeCloudflareAiGatewayResponse,
  createApiRequestObserver,
  decryptCloudflareAiGatewayByokProxyCredential,
  withApiSurfaceSpan,
  DynamicUserWorkflow,
  DynamicWorkflowBinding,
  handleGitHubAppWebhookRequest,
  handleWorkflowPublicRequest,
  isMcpPath,
  requestWithCloudflareProviderNativeCredential,
  requestWithSharedProviderCredential,
  resolveSharedProviderCredential,
  resolveSharedProviderApiKey,
  resolveSharedProviderOutboundHosts,
  SessionDO,
  sharedProviderPathClass,
  sharedProviderRequestModel,
  SHARED_PROVIDER_OUTBOUND_HANDLER,
  shouldDispatchMcpRequest,
  WorkflowActionExecutor,
  WorkflowAlarmDO,
} from "@solzero/api/server"
import type { ApiEnv } from "infra/types/env"

export {
  DynamicUserWorkflow,
  DynamicWorkflowBinding,
  IsolateSessionAgent,
  IsolateSubAgent,
  SessionDO,
  WorkflowAlarmDO,
  ContainerProxy,
}

const noopCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
  tracing,
}
const INTERNAL_MCP_OUTBOUND_HANDLER = "internalMcp"

async function credentialRateLimitKey(request: Request): Promise<string> {
  const clientAddress =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown"
  const body: { email?: unknown } = await request
    .clone()
    .json<{ email?: unknown }>()
    .catch(() => ({}))
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "unknown"
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${clientAddress}\u0000${email}`),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function tracedExecutionContext(ctx: ExecutionContext): ExecutionContext {
  return {
    waitUntil: (promise) => ctx.waitUntil(promise),
    passThroughOnException: () => ctx.passThroughOnException(),
    props: ctx.props,
    tracing: ctx.tracing ?? tracing,
  }
}

const internalMcpOutbound: OutboundHandler<ApiEnv> = (request, env) => {
  const observer = createApiRequestObserver(request, env, noopCtx)
  return observer.run(async ({ observability, setRouteBranch, log }) => {
    return dispatchMcpRequest(request, env, noopCtx, observability, setRouteBranch, log)
  })
}

const containerAiProviderOutbound: OutboundHandler<ApiEnv> = (request, env) => {
  const observer = createApiRequestObserver(request, env, noopCtx)
  return observer.run(async ({ setRouteBranch, log }) => {
    setRouteBranch("agent-container-ai-provider-outbound")
    const url = new URL(request.url)
    const credential = resolveSharedProviderCredential(env, url)
    const apiKeyOption = credential.pipe(
      Option.flatMap(({ secretName }) => resolveSharedProviderApiKey(env, secretName)),
    )
    const requestedModel = await sharedProviderRequestModel(request)
    const providerCredential = Option.match(credential, {
      onNone: () => null,
      onSome: ({ secretName }) => secretName,
    })
    log.set({
      outboundHost: url.hostname,
      providerCredential,
      pathClass: sharedProviderPathClass(url),
      hasCredential: Option.isSome(apiKeyOption),
      requestedModel,
    })

    return Option.match(credential, {
      onNone: async () => {
        // oxlint-disable-next-line effect/avoid-native-fetch -- Non-AI Cloudflare API traffic must pass through without receiving the scoped AI Gateway credential.
        return fetch(request)
      },
      onSome: ({ kind, headers }) =>
        Option.match(apiKeyOption, {
          onNone: () =>
            Response.json(
              { error: "Shared provider credential is not configured" },
              { status: 502 },
            ),
          onSome: async (apiKey) => {
            const providerApiKey =
              kind === "cloudflare-provider-native"
                ? await Effect.runPromise(
                    decryptCloudflareAiGatewayByokProxyCredential(
                      request,
                      env.TOKEN_ENCRYPTION_KEY,
                    ),
                  )
                : Option.none<string>()
            const authenticatedRequest =
              kind === "cloudflare-provider-native"
                ? requestWithCloudflareProviderNativeCredential(request, apiKey, providerApiKey)
                : requestWithSharedProviderCredential(request, apiKey, headers)
            // oxlint-disable-next-line effect/avoid-native-fetch -- Sandbox outbound handlers are Worker fetch boundaries; no Effect HttpClient layer is available in this container hook.
            const response = await fetch(authenticatedRequest)
            log.set({ upstreamStatus: response.status })
            return sharedProviderPathClass(url) === "cloudflare-ai-gateway"
              ? normalizeCloudflareAiGatewayResponse(response)
              : response
          },
        }),
    })
  })
}

abstract class AgentContainerBase extends Container<ApiEnv> {
  defaultPort = 8787
  sleepAfter = "1h"
  enableInternet = true
  interceptHttps = true

  constructor(ctx: DurableObjectState<{}>, env: ApiEnv) {
    super(ctx, env)

    const outboundHost = getStageMetadataSync(env).infra.internalMcpOutboundHost
    const outboundByHost: Record<string, string> = outboundHost
      ? {
          [outboundHost]: INTERNAL_MCP_OUTBOUND_HANDLER,
        }
      : {}

    this.ctx.blockConcurrencyWhile(async () => {
      const sharedProviderOutboundHosts = await Effect.runPromise(
        resolveSharedProviderOutboundHosts(env),
      )
      await this.setOutboundByHosts({
        ...outboundByHost,
        ...Object.fromEntries(
          sharedProviderOutboundHosts.map((host) => [host, SHARED_PROVIDER_OUTBOUND_HANDLER]),
        ),
      })
    })
  }
}

export class OpenCodeAgentContainer extends AgentContainerBase {}
export class CodexAgentContainer extends AgentContainerBase {}
export class ClaudeCodeAgentContainer extends AgentContainerBase {}

const agentContainerOutboundHandlers = {
  [INTERNAL_MCP_OUTBOUND_HANDLER]: internalMcpOutbound,
  [SHARED_PROVIDER_OUTBOUND_HANDLER]: containerAiProviderOutbound,
}

OpenCodeAgentContainer.outboundHandlers = agentContainerOutboundHandlers
CodexAgentContainer.outboundHandlers = agentContainerOutboundHandlers
ClaudeCodeAgentContainer.outboundHandlers = agentContainerOutboundHandlers

export class WorkflowActions extends WorkerEntrypoint<ApiEnv> {
  executeWorkflowNode(input: Parameters<WorkflowActionExecutor["executeWorkflowNode"]>[0]) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/execute-node",
      input,
      async (log) => {
        log.set({
          ...workflowActionBaseContext(input),
          inputKeys: Object.keys(input.inputs).sort(),
          optionKeys: Object.keys(input.node.options ?? {}).sort(),
        })
        const result = await new WorkflowActionExecutor(this.env, log).executeWorkflowNode(input)
        log.set({
          ...workflowActionBaseContext(input),
          outputKeys: Object.keys(result.outputs ?? {}).sort(),
        })
        return result
      },
    )
  }

  recordWorkflowEvent(input: Parameters<WorkflowActionExecutor["recordWorkflowEvent"]>[0]) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/record-event",
      input,
      async (log) => {
        log.set({
          workflowId: input.workflowId,
          runId: input.runId,
          nodeId: input.nodeId ?? null,
          eventType: input.eventType,
          level: input.level ?? "info",
          messageLength: input.message.length,
        })
        return new WorkflowActionExecutor(this.env, log).recordWorkflowEvent(input)
      },
    )
  }

  completeWorkflowRun(input: Parameters<WorkflowActionExecutor["completeWorkflowRun"]>[0]) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/complete-run",
      input,
      async (log) => {
        log.set({
          workflowId: input.workflowId,
          runId: input.runId,
          workflowStatus: input.status,
          hasOutput: Boolean(input.output),
          hasError: Boolean(input.error),
        })
        return new WorkflowActionExecutor(this.env, log).completeWorkflowRun(input)
      },
    )
  }
}

async function observeWorkflowAction<T>(
  env: ApiEnv,
  ctx: ExecutionContext,
  path: string,
  input: { workflowId: string; runId: string; userId?: string; oktaUserId?: string | null },
  handler: (log: ReturnType<typeof createApiRequestObserver>["log"]) => Promise<T>,
): Promise<T> {
  const tracedCtx = tracedExecutionContext(ctx)
  const observer = createApiRequestObserver(
    new Request(`http://workflow-actions.internal${path}`, { method: "POST" }),
    env,
    tracedCtx,
  )
  observer.setRouteBranch("workflow-action")
  if (input.userId) {
    observer.setUserIdentity({ userId: input.userId, oktaUserId: input.oktaUserId })
  }
  observer.log.set({
    workflowId: input.workflowId,
    runId: input.runId,
  })

  let result: T | undefined
  await observer.run(async () => {
    result = await handler(observer.log)
    return new Response(null, { status: 200 })
  })
  return result as T
}

function workflowActionBaseContext(
  input: Parameters<WorkflowActionExecutor["executeWorkflowNode"]>[0],
) {
  return {
    workflowId: input.workflowId,
    runId: input.runId,
    nodeId: input.node.id,
    nodeType: input.node.type,
    nodeLabel: input.node.label,
  }
}

export default class Api extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const env = this.env
    const tracedCtx = tracedExecutionContext(this.ctx)
    const stageMetadata = getStageMetadataSync(env)

    const observer = createApiRequestObserver(request, env, tracedCtx)
    return observer.run(async ({ setRouteBranch, setUserIdentity, observability, log }) => {
      if (isMcpPath(url.pathname)) {
        const shouldDispatchMcp = await shouldDispatchMcpRequest({
          request,
          mcpcfProxySigningSecret: env.MCPCF_PROXY_SIGNING_SECRET,
          workerRouteEnabled: stageMetadata.infra.internalMcpWorkerRouteEnabled,
        })
        if (shouldDispatchMcp) {
          return dispatchMcpRequest(request, env, tracedCtx, observability, setRouteBranch, log)
        }

        setRouteBranch("internal-mcp-not-found")
        return withApiSurfaceSpan(observability, "internal_mcp_not_found", () =>
          Promise.resolve(new Response(null, { status: 404 })),
        )
      }

      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        setRouteBranch("auth-provider-config")
        return withApiSurfaceSpan(observability, "auth_provider_config", async () => {
          const config = await Effect.runPromise(getPublicAuthProviderRegistry(env))
          if (
            config.providers.some(
              (provider) => provider.kind === "credential" && provider.capabilities.signIn,
            )
          ) {
            await reconcileManagedAdminCredentials(env)
          }
          return Response.json(config)
        })
      }

      if (url.pathname.startsWith("/api/auth")) {
        setRouteBranch("better-auth")
        return withApiSurfaceSpan(observability, "better_auth", async () => {
          const authConfig = await Effect.runPromise(getAuthProviderRegistry(env))
          const credentialProvider = authConfig.providers.credential
          if (credentialProvider?.enabled && credentialProvider.capabilities.signIn) {
            if (url.pathname === "/api/auth/sign-in/email") {
              const { success } = await env.AUTH_SIGN_IN_RATE_LIMIT.limit({
                key: await credentialRateLimitKey(request),
              })
              if (!success) {
                return Response.json({ message: "Too many sign-in attempts" }, { status: 429 })
              }
            }
            await reconcileManagedAdminCredentials(env)
          }
          return createBetterAuth(env, authConfig).handler(request)
        })
      }

      if (url.pathname === "/github/webhook" || url.pathname === "/api/github/webhook") {
        setRouteBranch("github-app-webhook")
        return withApiSurfaceSpan(observability, "github_app_webhook", () =>
          handleGitHubAppWebhookRequest(request, env),
        )
      }

      const workflowPublicResponse = await withApiSurfaceSpan(
        observability,
        "workflow_public",
        () =>
          handleWorkflowPublicRequest(request, env, {
            setUserIdentity,
            setRouteBranch,
            log,
          }),
        {
          attributes: (response) => ({ "api.surface.matched": Boolean(response) }),
          response: (response) => response,
        },
      )
      if (workflowPublicResponse) {
        setRouteBranch("workflow-public")
        return workflowPublicResponse
      }

      const sessionWebSocketResponse = await withApiSurfaceSpan(
        observability,
        "session_websocket",
        () => handleSessionWebSocketRequest(request, env),
        {
          attributes: (response) => ({ "api.surface.matched": Boolean(response) }),
          response: (response) => response,
        },
      )
      if (sessionWebSocketResponse) {
        setRouteBranch("session-websocket")
        return sessionWebSocketResponse
      }

      setRouteBranch("effect-http-api")
      return effectApiHandler(request, makeCloudflareContext(env, tracedCtx, observability))
    })
  }

  async scheduled(controller: ScheduledController): Promise<void> {
    return cron(controller, this.env, this.ctx)
  }
}

function dispatchMcpRequest(
  request: Request,
  env: ApiEnv,
  ctx: ExecutionContext,
  observability: ReturnType<typeof createApiRequestObserver>["observability"],
  setRouteBranch: (branch: string) => void,
  log: ReturnType<typeof createApiRequestObserver>["log"],
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (
    pathname === INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE ||
    pathname === `${INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE}/`
  ) {
    setRouteBranch("workflow-builder-mcp")
    return withApiSurfaceSpan(observability, "workflow_builder_mcp", () =>
      handleWorkflowBuilderMcpRequest(request, env, ctx),
    )
  }

  if (pathname === MCPCF_PROXY_MCP_ROUTE || pathname === `${MCPCF_PROXY_MCP_ROUTE}/`) {
    setRouteBranch("mcpcf-mcp")
    return withApiSurfaceSpan(observability, "mcpcf_mcp", () =>
      handleMcpcfMcpRequest(request, env, ctx, { log }),
    )
  }

  setRouteBranch("ai-search-mcp")
  return withApiSurfaceSpan(observability, "ai_search_mcp", () =>
    handleAiSearchMcpRequest(request, env, ctx, { log }),
  )
}
