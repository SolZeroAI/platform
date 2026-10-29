import { WorkerEntrypoint, tracing } from "cloudflare:workers"
import { Container, ContainerProxy, type OutboundHandler } from "@cloudflare/containers"
import { canonicalApiPath, getStageMetadataSync } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
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
  prepareWorkersAiResponses,
  streamWorkersAiResponse,
  aiGatewayForEnv,
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

type ApiRequestObserver = ReturnType<typeof createApiRequestObserver>

type SharedProviderCredential = Option.Option.Value<
  ReturnType<typeof resolveSharedProviderCredential>
>

type PreparedWorkersAiRequest = Awaited<ReturnType<typeof prepareWorkersAiResponses>>

async function credentialRateLimitKey(request: Request): Promise<string> {
  const clientAddress =
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown"

  const body: { email?: unknown } = await request
    .clone()
    .json<{ email?: unknown }>()
    .catch(() => ({}))

  const email = Match.value(body.email).pipe(
    Match.when(Match.string, (value) => value.trim().toLowerCase()),
    Match.orElse(() => "unknown"),
  )

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

/** Names the route branch, then runs the handler inside its API surface span. */
function routeSurface(
  observer: ApiRequestObserver,
  branch: string,
  surface: Parameters<typeof withApiSurfaceSpan>[1],
  handler: () => Promise<Response>,
): Promise<Response> {
  observer.setRouteBranch(branch)

  return withApiSurfaceSpan(observer.observability, surface, handler)
}

const internalMcpOutbound: OutboundHandler<ApiEnv> = (request, env) =>
  createApiRequestObserver(request, env, noopCtx).run((observer) =>
    dispatchMcpRequest(request, env, noopCtx, observer),
  )

/** Workers AI rejects some Responses payloads before forwarding. Those become a 400, not a 5xx. */
const prepareSharedProviderRequest = (request: Request) =>
  prepareWorkersAiResponses(request).catch((error: unknown) =>
    Match.value(error).pipe(
      Match.when(
        (candidate: unknown): candidate is Error =>
          candidate instanceof Error && candidate.message.startsWith("Workers AI"),
        (invalid) => invalid,
      ),
      Match.orElse((other) => Promise.reject(other)),
    ),
  )

async function authenticateSharedProviderRequest(
  request: Request,
  prepared: PreparedWorkersAiRequest,
  env: ApiEnv,
  credential: SharedProviderCredential,
  apiKey: string,
): Promise<Request> {
  return Match.value(credential.kind).pipe(
    Match.when("cloudflare-provider-native", async () =>
      requestWithCloudflareProviderNativeCredential(
        request,
        apiKey,
        await Effect.runPromise(
          decryptCloudflareAiGatewayByokProxyCredential(request, env.TOKEN_ENCRYPTION_KEY),
        ),
      ),
    ),
    Match.orElse(async () =>
      requestWithSharedProviderCredential(prepared.request, apiKey, credential.headers),
    ),
  )
}

async function forwardSharedProviderRequest(
  request: Request,
  prepared: PreparedWorkersAiRequest,
  env: ApiEnv,
  observer: ApiRequestObserver,
  credential: SharedProviderCredential,
  apiKey: string,
): Promise<Response> {
  const url = new URL(request.url)

  const authenticatedRequest = await authenticateSharedProviderRequest(
    request,
    prepared,
    env,
    credential,
    apiKey,
  )

  // LiteLLM is not an AI Gateway route, so only Cloudflare credentials use the gateway layer.
  const upstream = await Match.value(credential.kind).pipe(
    Match.when("bearer", () => fetch(authenticatedRequest)),
    Match.orElse(() => aiGatewayForEnv(env).fetch(authenticatedRequest)),
  )

  const response = await Match.value(prepared.streaming).pipe(
    Match.when(true, () => streamWorkersAiResponse(upstream, prepared.functionNames)),
    Match.orElse(() => Promise.resolve(upstream)),
  )

  observer.log.set({ upstreamStatus: response.status })

  return Match.value(sharedProviderPathClass(url)).pipe(
    Match.when("cloudflare-ai-gateway", () => normalizeCloudflareAiGatewayResponse(response)),
    Match.orElse(() => Promise.resolve(response)),
  )
}

async function respondWithSharedProviderCredential(
  request: Request,
  env: ApiEnv,
  observer: ApiRequestObserver,
  credential: SharedProviderCredential,
  apiKey: string,
): Promise<Response> {
  const prepared = await prepareSharedProviderRequest(request)

  return Match.value(prepared).pipe(
    Match.when(
      (candidate): candidate is Error => candidate instanceof Error,
      (invalid) =>
        Response.json(
          { error: { message: invalid.message, type: "invalid_request_error" } },
          { status: 400 },
        ),
    ),
    Match.orElse((ready) =>
      forwardSharedProviderRequest(request, ready, env, observer, credential, apiKey),
    ),
  )
}

async function containerAiProviderResponse(
  request: Request,
  env: ApiEnv,
  observer: ApiRequestObserver,
): Promise<Response> {
  observer.setRouteBranch("agent-container-ai-provider-outbound")
  const url = new URL(request.url)
  const credential = resolveSharedProviderCredential(env, url)

  const apiKeyOption = credential.pipe(
    Option.flatMap(({ secretName }) => resolveSharedProviderApiKey(env, secretName)),
  )

  const requestedModel = await sharedProviderRequestModel(request)

  const providerCredential = Option.getOrNull(
    Option.map(credential, ({ secretName }) => secretName),
  )

  observer.log.set({
    outboundHost: url.hostname,
    providerCredential,
    pathClass: sharedProviderPathClass(url),
    hasCredential: Option.isSome(apiKeyOption),
    requestedModel,
  })

  return Option.match(credential, {
    // Non-AI Cloudflare API traffic passes through without the scoped AI Gateway credential.
    onNone: () => fetch(request),
    onSome: (shared) =>
      Option.match(apiKeyOption, {
        onNone: async () =>
          Response.json({ error: "Shared provider credential is not configured" }, { status: 502 }),
        onSome: (apiKey) =>
          respondWithSharedProviderCredential(request, env, observer, shared, apiKey),
      }),
  })
}

const containerAiProviderOutbound: OutboundHandler<ApiEnv> = (request, env) =>
  createApiRequestObserver(request, env, noopCtx).run((observer) =>
    containerAiProviderResponse(request, env, observer),
  )

abstract class AgentContainerBase extends Container<ApiEnv> {
  defaultPort = 8787
  sleepAfter = "1h"
  enableInternet = true
  interceptHttps = true

  constructor(ctx: DurableObjectState<{}>, env: ApiEnv) {
    super(ctx, env)

    const outboundByHost: Record<string, string> = Option.match(
      Option.fromNullishOr(getStageMetadataSync(env).infra.internalMcpOutboundHost),
      {
        onNone: () => ({}),
        onSome: (host) => ({ [host]: INTERNAL_MCP_OUTBOUND_HANDLER }),
      },
    )

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

type ExecuteWorkflowNodeInput = Parameters<WorkflowActionExecutor["executeWorkflowNode"]>[0]

type RecordWorkflowEventInput = Parameters<WorkflowActionExecutor["recordWorkflowEvent"]>[0]

type CompleteWorkflowRunInput = Parameters<WorkflowActionExecutor["completeWorkflowRun"]>[0]

async function executeWorkflowNode(
  env: ApiEnv,
  log: ApiRequestObserver["log"],
  input: ExecuteWorkflowNodeInput,
) {
  log.set({
    ...workflowActionBaseContext(input),
    inputKeys: Object.keys(input.inputs).sort(),
    optionKeys: Object.keys(input.node.options ?? {}).sort(),
  })

  const result = await new WorkflowActionExecutor(env, log).executeWorkflowNode(input)

  log.set({
    ...workflowActionBaseContext(input),
    outputKeys: Object.keys(result.outputs ?? {}).sort(),
  })

  return result
}

function recordWorkflowEvent(
  env: ApiEnv,
  log: ApiRequestObserver["log"],
  input: RecordWorkflowEventInput,
) {
  log.set({
    workflowId: input.workflowId,
    runId: input.runId,
    nodeId: input.nodeId ?? null,
    eventType: input.eventType,
    level: input.level ?? "info",
    messageLength: input.message.length,
  })

  return new WorkflowActionExecutor(env, log).recordWorkflowEvent(input)
}

function completeWorkflowRun(
  env: ApiEnv,
  log: ApiRequestObserver["log"],
  input: CompleteWorkflowRunInput,
) {
  log.set({
    workflowId: input.workflowId,
    runId: input.runId,
    workflowStatus: input.status,
    hasOutput: Boolean(input.output),
    hasError: Boolean(input.error),
  })

  return new WorkflowActionExecutor(env, log).completeWorkflowRun(input)
}

export class WorkflowActions extends WorkerEntrypoint<ApiEnv> {
  executeWorkflowNode(input: ExecuteWorkflowNodeInput) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/execute-node",
      input,
      (log) => executeWorkflowNode(this.env, log, input),
    )
  }

  recordWorkflowEvent(input: RecordWorkflowEventInput) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/record-event",
      input,
      (log) => recordWorkflowEvent(this.env, log, input),
    )
  }

  completeWorkflowRun(input: CompleteWorkflowRunInput) {
    return observeWorkflowAction(
      this.env,
      this.ctx,
      "/workflow-actions/complete-run",
      input,
      (log) => completeWorkflowRun(this.env, log, input),
    )
  }
}

async function observeWorkflowAction<T>(
  env: ApiEnv,
  ctx: ExecutionContext,
  path: string,
  input: { workflowId: string; runId: string; userId?: string; oktaUserId?: string | null },
  handler: (log: ApiRequestObserver["log"]) => Promise<T>,
): Promise<T> {
  const tracedCtx = tracedExecutionContext(ctx)

  const observer = createApiRequestObserver(
    new Request(`http://workflow-actions.internal${path}`, { method: "POST" }),
    env,
    tracedCtx,
  )

  observer.setRouteBranch("workflow-action")

  Option.match(Option.liftPredicate(input.userId ?? "", Boolean), {
    onNone: () => undefined,
    onSome: (userId) => observer.setUserIdentity({ userId, oktaUserId: input.oktaUserId }),
  })

  observer.log.set({
    workflowId: input.workflowId,
    runId: input.runId,
  })

  let resolveOutcome: (value: T) => void = () => undefined

  const outcome = new Promise<T>((resolve) => {
    resolveOutcome = resolve
  })

  async function runHandler(): Promise<Response> {
    resolveOutcome(await handler(observer.log))

    return new Response(null, { status: 200 })
  }

  // A thrown handler rejects the run, so the outcome is only read after the handler resolves it.
  await observer.run(runHandler)

  return outcome
}

function workflowActionBaseContext(input: ExecuteWorkflowNodeInput) {
  return {
    workflowId: input.workflowId,
    runId: input.runId,
    nodeId: input.node.id,
    nodeType: input.node.type,
    nodeLabel: input.node.label,
  }
}

interface ApiRoute {
  readonly request: Request
  readonly url: URL
  readonly env: ApiEnv
  readonly ctx: ExecutionContext
  readonly stageMetadata: ReturnType<typeof getStageMetadataSync>
  readonly observer: ApiRequestObserver
}

const reconcileAdminCredentialsWhen = (enabled: boolean, env: ApiEnv) =>
  Match.value(enabled).pipe(
    Match.when(true, () => reconcileManagedAdminCredentials(env)),
    Match.orElse(() => Promise.resolve()),
  )

async function publicAuthConfigResponse(env: ApiEnv): Promise<Response> {
  const config = await Effect.runPromise(getPublicAuthProviderRegistry(env))

  await reconcileAdminCredentialsWhen(
    config.providers.some(
      (provider) => provider.kind === "credential" && provider.capabilities.signIn,
    ),
    env,
  )

  return Response.json(config)
}

async function signInRateLimited(env: ApiEnv, request: Request): Promise<boolean> {
  const { success } = await env.AUTH_SIGN_IN_RATE_LIMIT.limit({
    key: await credentialRateLimitKey(request),
  })

  return !success
}

async function betterAuthResponse({ request, url, env }: ApiRoute): Promise<Response> {
  const authConfig = await Effect.runPromise(getAuthProviderRegistry(env))
  const credentialProvider = authConfig.providers.credential

  const credentialSignIn =
    credentialProvider?.enabled === true && credentialProvider.capabilities.signIn

  const rateLimited = await Match.value(
    credentialSignIn && url.pathname === "/api/auth/sign-in/email",
  ).pipe(
    Match.when(true, () => signInRateLimited(env, request)),
    Match.orElse(() => Promise.resolve(false)),
  )

  return Match.value(rateLimited).pipe(
    Match.when(true, () =>
      Response.json({ message: "Too many sign-in attempts" }, { status: 429 }),
    ),
    Match.orElse(() =>
      reconcileAdminCredentialsWhen(credentialSignIn, env).then(() =>
        createBetterAuth(env, authConfig).handler(request),
      ),
    ),
  )
}

async function routeMcpRequest(route: ApiRoute): Promise<Response> {
  const shouldDispatchMcp = await shouldDispatchMcpRequest({
    request: route.request,
    mcpcfProxySigningSecret: route.env.MCPCF_PROXY_SIGNING_SECRET,
    workerRouteEnabled: route.stageMetadata.infra.internalMcpWorkerRouteEnabled,
  })

  return Match.value(shouldDispatchMcp).pipe(
    Match.when(true, () => dispatchMcpRequest(route.request, route.env, route.ctx, route.observer)),
    Match.orElse(() =>
      routeSurface(route.observer, "internal-mcp-not-found", "internal_mcp_not_found", () =>
        Promise.resolve(new Response(null, { status: 404 })),
      ),
    ),
  )
}

/** A matched dynamic route names its branch and returns its own response. */
function matchedRoute(observer: ApiRequestObserver, branch: string, response: Response): Response {
  observer.setRouteBranch(branch)

  return response
}

const matchedSurface = {
  attributes: (response: Response | null | undefined) => ({
    "api.surface.matched": Boolean(response),
  }),
  response: (response: Response | null | undefined) => response,
}

function effectHttpApiResponse(route: ApiRoute): Promise<Response> {
  route.observer.setRouteBranch("effect-http-api")

  return effectApiHandler(
    route.request,
    makeCloudflareContext(route.env, route.ctx, route.observer.observability),
  )
}

async function effectApiRoute(route: ApiRoute): Promise<Response> {
  const sessionWebSocketResponse = await withApiSurfaceSpan(
    route.observer.observability,
    "session_websocket",
    () => handleSessionWebSocketRequest(route.request, route.env),
    matchedSurface,
  )

  return Option.match(Option.fromNullishOr(sessionWebSocketResponse), {
    onSome: (response) => matchedRoute(route.observer, "session-websocket", response),
    onNone: () => effectHttpApiResponse(route),
  })
}

async function dynamicRoute(route: ApiRoute): Promise<Response> {
  const workflowPublicResponse = await withApiSurfaceSpan(
    route.observer.observability,
    "workflow_public",
    () =>
      handleWorkflowPublicRequest(route.request, route.env, {
        setUserIdentity: route.observer.setUserIdentity,
        setRouteBranch: route.observer.setRouteBranch,
        log: route.observer.log,
      }),
    matchedSurface,
  )

  return Option.match(Option.fromNullishOr(workflowPublicResponse), {
    onSome: (response) => matchedRoute(route.observer, "workflow-public", response),
    onNone: () => effectApiRoute(route),
  })
}

function routeApiRequest(route: ApiRoute): Promise<Response> {
  const { pathname } = route.url

  return Match.value(pathname).pipe(
    Match.when(isMcpPath, () => routeMcpRequest(route)),
    Match.when(
      (path) => path === "/api/auth/config" && route.request.method === "GET",
      () =>
        routeSurface(route.observer, "auth-provider-config", "auth_provider_config", () =>
          publicAuthConfigResponse(route.env),
        ),
    ),
    Match.when(
      (path) => path.startsWith("/api/auth"),
      () =>
        routeSurface(route.observer, "better-auth", "better_auth", () => betterAuthResponse(route)),
    ),
    Match.when(
      (path) => path === "/github/webhook" || path === "/api/github/webhook",
      () =>
        routeSurface(route.observer, "github-app-webhook", "github_app_webhook", () =>
          handleGitHubAppWebhookRequest(route.request, route.env),
        ),
    ),
    Match.orElse(() => dynamicRoute(route)),
  )
}

export default class Api extends WorkerEntrypoint {
  async fetch(request: Request): Promise<Response> {
    const env = this.env
    const ctx = tracedExecutionContext(this.ctx)
    const stageMetadata = getStageMetadataSync(env)
    const url = new URL(request.url)
    url.pathname = canonicalApiPath(url.pathname)
    const canonicalRequest = new Request(url, request)

    return createApiRequestObserver(canonicalRequest, env, ctx).run((observer) =>
      routeApiRequest({ request: canonicalRequest, url, env, ctx, stageMetadata, observer }),
    )
  }

  async scheduled(controller: ScheduledController): Promise<void> {
    return cron(controller, this.env, this.ctx)
  }
}

function dispatchMcpRequest(
  request: Request,
  env: ApiEnv,
  ctx: ExecutionContext,
  observer: ApiRequestObserver,
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  const isRoute = (route: string) => pathname === route || pathname === `${route}/`

  return Match.value(pathname).pipe(
    Match.when(
      () => isRoute(INTERNAL_WORKFLOW_BUILDER_MCP_ROUTE),
      () =>
        routeSurface(observer, "workflow-builder-mcp", "workflow_builder_mcp", () =>
          handleWorkflowBuilderMcpRequest(request, env, ctx),
        ),
    ),
    Match.when(
      () => isRoute(MCPCF_PROXY_MCP_ROUTE),
      () =>
        routeSurface(observer, "mcpcf-mcp", "mcpcf_mcp", () =>
          handleMcpcfMcpRequest(request, env, ctx, { log: observer.log }),
        ),
    ),
    Match.orElse(() =>
      routeSurface(observer, "ai-search-mcp", "ai_search_mcp", () =>
        handleAiSearchMcpRequest(request, env, ctx, { log: observer.log }),
      ),
    ),
  )
}
