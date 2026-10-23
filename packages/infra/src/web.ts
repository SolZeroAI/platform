import { resolve } from "node:path"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import { deployedWebWorkerName, type S0BrandConfig, type StageMetadata } from "@solzero/shared"
import type { DeploymentMetadata } from "./deploymentMetadata"

function jsonBinding(value: unknown): Schema.Json {
  return value as Schema.Json
}

function webDevOptions(dev: boolean): Partial<Pick<Cloudflare.Website.ViteProps, "dev">> {
  return Match.value(dev).pipe(
    Match.when(true, () => ({
      dev: {
        port: 3000,
        strictPort: true,
      },
    })),
    Match.orElse(() => ({})),
  )
}

export interface CreateWebOptions {
  appName: string
  brand: S0BrandConfig
  stageMetadata: StageMetadata
  deploymentMetadata: DeploymentMetadata
  repoRoot: string
  dev: boolean
  apiWorker?: Cloudflare.Worker
}

export function createWeb(options: CreateWebOptions) {
  const { appName, brand, stageMetadata, deploymentMetadata, repoRoot, dev } = options
  const [primaryDomain, ...domainAliases] = stageMetadata.infra.webDomains

  return Cloudflare.Website.Vite("web", {
    name: deployedWebWorkerName(appName, stageMetadata.name),
    rootDir: resolve(repoRoot, "apps/web"),
    compatibility: {
      date: "2026-04-15",
      flags: ["nodejs_compat"],
    },
    observability: {
      enabled: true,
    },
    ...webDevOptions(dev),
    // oxlint-disable-next-line s0-lint/no-ternary -- Alchemy domain config is optional only for deployed stages.
    ...(primaryDomain
      ? {
          domain: {
            name: primaryDomain,
            aliases: domainAliases,
          },
          workersDev: false,
        }
      : {}),
    env: {
      ...Option.match(Option.fromNullishOr(options.apiWorker), {
        onNone: () => ({}),
        onSome: (api) => ({ S0_API: Cloudflare.WorkerEntrypoint(api) }),
      }),
      STAGE: stageMetadata.name,
      VITE_STAGE: stageMetadata.name,
      VITE_APP_VERSION: deploymentMetadata.appVersion,
      VITE_COMMIT_SHA: deploymentMetadata.commitSha,
      VITE_S0_BRAND_NAME: brand.name,
      VITE_S0_BRAND_LOGO_LIGHT_PATH: brand.logoLightPath,
      VITE_S0_BRAND_LOGO_DARK_PATH: brand.logoDarkPath,
      VITE_S0_BRAND_FAVICON_PATH: brand.faviconPath,
      VITE_S0_BRAND_APPLE_TOUCH_ICON_PATH: brand.appleTouchIconPath,
      S0_STAGE_METADATA: jsonBinding({
        _tag: stageMetadata._tag,
        name: stageMetadata.name,
        app: stageMetadata.app,
        infra: stageMetadata.infra,
      }),
      VITE_S0_LOG_LEVEL: stageMetadata.app.logLevel,
      VITE_S0_SHOW_TEST_ERROR_BUTTON: String(stageMetadata.app.showTestErrorButton),
      VITE_S0_BETTER_AUTH_SESSION_TRANSFER_ENABLED: String(
        stageMetadata.app.betterAuthSessionTransferEnabled,
      ),
      VITE_S0_SANDBOX_INACTIVITY_TIMEOUT_MS: String(stageMetadata.app.sandboxInactivityTimeoutMs),
    },
  })
}

export type WebResource = Awaited<ReturnType<typeof createWeb>>
