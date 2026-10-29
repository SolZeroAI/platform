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
        // The rule flags every Schema.Struct. Plain JSON DTOs (config, bindings, wire formats) stay
        // Structs because Schema.Class decodes to instances and rejects plain objects on encode.
        "effect/prefer-schema-class": "off",
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
        "packages/api/src/server/background/ai-providers/litellm.ts",
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
