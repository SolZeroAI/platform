import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { parse } from "jsonc-parser"
import { resolveS0Config, s0ConfigPathForStage } from "@solzero/shared"
import { appEnvironment } from "./environment"
import { recoverRuns } from "./lifecycle"
import { restoreHostedOwnership } from "./hosted-ownership"

const ownershipFile = process.argv[2]
if (ownershipFile) await restoreHostedOwnership(ownershipFile)
await recoverRuns()

const CleanupResource = Schema.Struct({
  resourceType: Schema.optional(Schema.String),
  providerMode: Schema.optional(Schema.String),
  props: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.String),
    }),
  ),
  attr: Schema.optional(
    Schema.Struct({
      gatewayId: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      accountId: Schema.optional(Schema.String),
    }),
  ),
})

const profile = process.env.E2E_CONFIG_PROFILE ?? "e2e"
const config = resolveS0Config(parse(readFileSync(s0ConfigPathForStage("dev", profile), "utf8")))
const appName = config.deployment.appName
if (!/^s0-e2e(?:-[a-z0-9-]+)?$/.test(appName)) {
  throw new Error("Cleanup requires an isolated s0-e2e development profile.")
}
const ci = await Effect.runPromise(Config.boolean("CI").pipe(Config.withDefault(false)))
const gatewayId = `${appName}${ci ? "-ci" : ""}-dev-ai-gateway`
const tokenName = `${appName}-dev-ai-gateway-run`
const stateRoot = resolve("packages/infra/.alchemy/state/S0/dev")
// Destroy only a proven local test stack. Never infer ownership from an account resource's prefix.
if (existsSync(stateRoot)) {
  for (const file of readdirSync(stateRoot).filter((name) => name.endsWith(".json"))) {
    let resource: Schema.Schema.Type<typeof CleanupResource>
    try {
      resource = Schema.decodeUnknownSync(CleanupResource)(
        JSON.parse(readFileSync(resolve(stateRoot, file), "utf8")),
      )
    } catch {
      throw new Error("Cleanup cannot validate the persisted resource state.")
    }
    if (!resource.resourceType) continue
    if (
      (resource.props?.accountId !== undefined &&
        resource.props.accountId !== process.env.CLOUDFLARE_ACCOUNT_ID) ||
      (resource.attr?.accountId !== undefined &&
        resource.attr.accountId !== process.env.CLOUDFLARE_ACCOUNT_ID)
    ) {
      throw new Error("Cleanup refused state from a different Cloudflare account.")
    }
    if (resource.resourceType === "Cloudflare.AI.Gateway") {
      if (
        resource.props?.id !== gatewayId ||
        (resource.attr?.gatewayId !== undefined && resource.attr.gatewayId !== gatewayId)
      ) {
        throw new Error("Cleanup refused a gateway outside the selected test profile.")
      }
    } else if (resource.resourceType === "Cloudflare.ApiToken.AccountApiToken") {
      if (
        resource.props?.name !== tokenName ||
        (resource.attr?.name !== undefined && resource.attr.name !== tokenName)
      ) {
        throw new Error("Cleanup refused a token outside the selected test profile.")
      }
    } else if (resource.providerMode !== "local" && resource.resourceType !== "Alchemy.Random") {
      throw new Error("Cleanup refused an unexpected remote resource in the local test stack.")
    }
    if (
      resource.resourceType === "Cloudflare.Worker" &&
      ![`${appName}-api-dev`, `${appName}-web-dev`].includes(resource.props?.name ?? "")
    ) {
      throw new Error("Cleanup refused a Worker outside the selected test profile.")
    }
  }
  const child = spawn("nub", ["run", "infra:destroy:dev"], {
    stdio: "inherit",
    env: appEnvironment,
  })
  child.on("error", () => {
    console.error("Could not start the Alchemy test infrastructure cleanup.")
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 130 : 1)
  })
}
