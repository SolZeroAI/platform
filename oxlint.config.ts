import { defineConfig } from "oxlint"
import {
  agentToolIgnorePatterns,
  effectRules,
  observabilityRules,
  recommended,
} from "oxlint-plugin-solzero/config"

const effectServiceFiles = [
  "apps/api/index.ts",
  "apps/api/infra/**",
  "packages/api/src/server/**",
  "packages/infra/src/**",
  "packages/shared/src/**",
]

// Alchemy stack definitions and the run scripts wire Cloudflare resources, not Effect services.
const nonEffectBoundaryFiles = ["packages/infra/alchemy*.run.ts", "packages/infra/src/stacks/**"]

export default defineConfig({
  extends: [recommended],
  // A disable comment that suppresses nothing fails lint, so stale suppressions cannot pile up.
  options: { reportUnusedDisableDirectives: "error" },
  plugins: ["unicorn", "typescript", "oxc", "react"],
  jsPlugins: [{ name: "effect", specifier: "@mpsuesser/oxlint-plugin-effect" }],
  ignorePatterns: [
    ...agentToolIgnorePatterns,
    "**/.cursor/plans/**",
    "node_modules",
    "dist",
    "**/.alchemy/**",
    "**/.output/**",
    "cloudflare-env-gen.d.ts",
    "**/*.gen.ts",
  ],
  rules: {
    "max-lines": ["error", { max: 1000, skipBlankLines: false, skipComments: false }],
    "solzero/no-colocated-tests": "error",
    // Ad hoc typeof, unknown parameters, unknown returns, and open dictionaries are the
    // parsers for provider JSON, tool arguments, workflow manifests, and Durable Object
    // migration RPCs. Replacing them needs a schema migration. A closed schema would reject
    // live payloads, so these four rules stay off until that migration.
    "anti-slop/no-runtime-typeof": "off",
    "anti-slop/no-unknown-parameters": "off",
    "anti-slop/no-unknown-returns": "off",
    "anti-slop/no-unsafe-dictionary-type": "off",
  },
  overrides: [
    {
      files: effectServiceFiles,
      rules: {
        ...effectRules("error"),
        "effect/avoid-try-catch": "warn",
        "effect/prefer-match-over-switch": "warn",
        "effect/imperative-loops": "warn",
        "effect/avoid-data-tagged-error": "warn",
        "effect/avoid-direct-json": "warn",
        "effect/avoid-option-getorthrow": "warn",
        "effect/avoid-process-env": "warn",
        "effect/effect-run-in-body": "warn",
        "effect/effect-promise-vs-trypromise": "warn",
        "effect/prefer-schema-class": "error",
        "effect/avoid-any": "warn",
        "effect/avoid-non-null-assertion": "warn",
        "effect/avoid-native-fetch": "warn",
        "effect/prefer-effect-fn": "warn",
        "effect/prefer-namespace-imports": "warn",
        "effect/prefer-redacted-config": "warn",
        "effect/no-barrel-imports": "warn",
      },
    },
    {
      // Plain JSON DTOs: config, manifests, provider settings, stage metadata, and values stored in
      // KV or Durable Object storage. Code builds and spreads them as object literals and writes
      // them back as JSON. A Schema.Class rejects a plain object on encode while TypeScript still
      // accepts the literal, and Durable Object RPC cannot serialize a class instance. So these
      // schemas stay Structs. Decode-only schemas elsewhere are classes.
      files: [
        "packages/api/src/server/background/db/errors.ts",
        "packages/api/src/server/background/workflows/alarm.ts",
        "packages/api/src/server/mcp/workflow-builder/runtime.ts",
        "packages/shared/src/admin.ts",
        "packages/shared/src/auth.ts",
        "packages/shared/src/provider-config.ts",
        "packages/shared/src/s0-config.ts",
        "packages/shared/src/secret-reference.ts",
        "packages/shared/src/session-artifact-schema.ts",
        "packages/shared/src/stageMetadata.ts",
        "packages/shared/src/workflows/manifest-schema.ts",
      ],
      rules: { "effect/prefer-schema-class": "off" },
    },
    {
      files: ["apps/api/index.ts", "apps/api/infra/**", "packages/api/src/server/**"],
      rules: observabilityRules("error"),
    },
    {
      files: nonEffectBoundaryFiles,
      rules: {
        ...effectRules("off"),
        ...observabilityRules("off"),
        // Alchemy Stack.make takes an Effect value. Effect.fn changes its inference.
        "effect/prefer-effect-fn": "off",
      },
    },
    {
      // Carried over from the s0-lint allowlist: the runner imports @cloudflare/dynamic-workflows on demand.
      files: ["packages/api/src/server/background/workflows/runner.ts"],
      rules: { "solzero/prevent-dynamic-imports": "off" },
    },
    {
      files: [
        "apps/web/src/components/admin-ai-provider-panel.tsx",
        "apps/web/src/components/home-session-tools-dialog.tsx",
        "apps/web/src/components/workflows/page.tsx",
        "packages/api/src/server/background/db/admin.ts",
        "packages/api/src/server/background/db/workflows.ts",
        "packages/api/src/server/background/workflows/slack-apps.ts",
        "packages/api/src/server/background/session/durable-object/processing.ts",
        "packages/api/src/server/effect/handlers/shared/control-plane/sessions.ts",
        "scripts/e2e/lifecycle.ts",
      ],
      rules: {
        // These files are already at the 1000-line max-lines cap. The spacing fix pushes them over it.
        "anti-slop/require-readable-spacing": "off",
      },
    },
    {
      // The Worker entrypoint is the Effect runtime edge. Its container outbound handlers proxy raw
      // requests, so they forward with the Worker fetch instead of an Effect HttpClient.
      files: ["apps/api/index.ts"],
      rules: { "effect/effect-run-in-body": "off", "effect/avoid-native-fetch": "off" },
    },
    {
      // The one Promise bridge for the non-Effect background runtime. Its helpers take the caller's
      // effect, so they name the Effect channels, and they return null for the Promise-facing views.
      files: ["packages/api/src/server/lib/effect-promise.ts"],
      rules: {
        "effect/effect-run-in-body": "off",
        "solzero/no-manual-effect-channels": "off",
        "solzero/prefer-option-over-null": "off",
      },
    },
    {
      // The session Durable Object is a composition root. It builds the tracing layer and the
      // control plane from its Worker env, then runs Effects through lib/effect-promise.
      files: [
        "packages/api/src/server/background/session/durable-object.ts",
        "packages/api/src/server/background/session/durable-object/*.ts",
      ],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // The workflow runtime runs outside the HTTP Layer: public routers, the alarm Durable Object,
      // the dynamic workflow loader, service-binding actions, and node executors. Each entrypoint
      // builds the control plane and internal clients from its Worker env.
      files: ["packages/api/src/server/background/workflows/**/*.ts"],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // The HTTP composition roots. The runtime installs the logger layer, CloudflareContext and
      // the API key check build the control plane from the Worker env, and the control-plane
      // modules open the D1 and Hyperdrive drizzle handles.
      files: [
        "packages/api/src/server/effect/db/control-plane-db.ts",
        "packages/api/src/server/effect/db/postgres-promise-drizzle.ts",
        "packages/api/src/server/effect/runtime.ts",
        "packages/api/src/server/effect/services/auth.ts",
        "packages/api/src/server/effect/services/cloudflare.ts",
      ],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // Background modules that run outside the HTTP Layer: the provider catalog, the LiteLLM cron
      // and config reads, and the sandbox manager and harness provider. Each builds the control
      // plane from its Worker env.
      files: [
        "packages/api/src/server/background/ai-providers/litellm.ts",
        "packages/api/src/server/background/provider-catalog.ts",
        "packages/api/src/server/background/sandbox/lifecycle/manager.ts",
        "packages/api/src/server/background/sandbox/providers/harness-container-provider.ts",
      ],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // The isolate Durable Objects (session agent and sub-agent) and their turn setup run outside
      // the HTTP Layer. Each builds the tracing layer, the control plane, and the AI Gateway layer
      // from its Worker env, then runs Effects through lib/effect-promise.
      files: [
        "packages/api/src/server/background/isolate/agent.ts",
        "packages/api/src/server/background/isolate/agent/subagent-controller.ts",
        "packages/api/src/server/background/isolate/agent/turn-surface.ts",
        "packages/api/src/server/background/isolate/model.ts",
        "packages/api/src/server/background/isolate/runtime.ts",
        "packages/api/src/server/background/isolate/subagent.ts",
      ],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // Better Auth and the MCP servers start outside the HTTP Layer. They build the control plane
      // from the Worker env before the library or MCP SDK takes the request.
      files: [
        "packages/api/src/server/lib/better-auth.ts",
        "packages/api/src/server/mcp/mcpcf-server/runtime.ts",
        "packages/api/src/server/mcp/workflow-builder/server.ts",
      ],
      rules: { "anti-slop-effect/no-service-constructor-imports": "off" },
    },
    {
      // The HTTP workflow node sends a user-authored request and reports the final URL, status
      // text, and raw body. It calls the Worker fetch with the node's abort signal directly.
      files: ["packages/api/src/server/background/workflows/nodes/http.ts"],
      rules: { "effect/avoid-native-fetch": "off" },
    },
    {
      // The isolate model fetch is the traced AI provider HTTP passthrough. The AI SDK takes a native
      // fetch implementation, and no HttpClient layer exists on this path.
      files: ["packages/api/src/server/background/isolate/model.ts"],
      rules: { "effect/avoid-native-fetch": "off" },
    },
    {
      // Operator process boundaries. They read DATABASE, APP_DB_MODE, and PlanetScale tokens (and copy
      // them to the names Alchemy reads) before an Alchemy context exists.
      files: [
        "packages/infra/src/database-engine.ts",
        "packages/infra/src/deploymentMetadata.ts",
        "packages/infra/src/stack-flags.ts",
      ],
      rules: { "effect/avoid-process-env": "off" },
    },
    {
      files: ["packages/infra/alchemy.run.ts", "packages/infra/src/index.ts"],
      rules: { "effect/avoid-process-env": "off", "effect/avoid-node-imports": "off" },
    },
  ],
})
