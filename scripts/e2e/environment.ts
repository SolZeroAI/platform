import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import dotenv from "dotenv"
import { parse, type ParseError } from "jsonc-parser"
import { resolveS0Config, s0ConfigPathForStage } from "@solzero/shared"

// Explicit process/CI values always take precedence over local files.
for (const file of [process.env.E2E_ENV_FILE, "config/.env", "config/.dev.vars"]) {
  if (file && existsSync(file)) dotenv.config({ path: resolve(file), quiet: true })
}
// workerd needs the trusted macOS roots explicitly; never replace a supplied CA bundle.
if (process.platform === "darwin" && !process.env.NODE_EXTRA_CA_CERTS) {
  const trusted = getCACertificates("system")
  if (trusted.length > 0) {
    setDefaultCACertificates([...getCACertificates("default"), ...trusted])
    mkdirSync(".e2e", { recursive: true })
    const path = resolve(".e2e/trusted-ca.pem")
    const pem = trusted.join("\n")
    if (!existsSync(path) || readFileSync(path, "utf8") !== pem) {
      writeFileSync(path, pem, { mode: 0o600 })
    }
    process.env.NODE_EXTRA_CA_CERTS = path
  }
}
// The core suite exercises source-image OpenCode and Codex runtimes.
process.env.E2E_CONTAINER_RUNTIME ??= "1"
const profile = process.env.E2E_CONFIG_PROFILE ?? "e2e"
if (!/^e2e(?:-[a-z0-9-]+)?$/.test(profile)) {
  throw new Error("E2E_CONFIG_PROFILE must be e2e or an isolated e2e-* profile.")
}
const configPath = resolve(s0ConfigPathForStage("dev", profile))
const configErrors: ParseError[] = []
const parsedConfig = parse(readFileSync(configPath, "utf8"), configErrors, {
  allowTrailingComma: true,
})
if (configErrors.length > 0) throw new Error("The selected e2e profile contains invalid JSONC.")
const config = resolveS0Config(parsedConfig)
if (!config.deployment.appName.startsWith("s0-e2e")) {
  throw new Error(
    "The selected e2e configuration must use deployment.appName starting with s0-e2e.",
  )
}
process.env.S0_CONFIG_PROFILE = profile
process.env.E2E_USER_ADMIN_USERNAME ??= "e2e-admin@example.test"
process.env.E2E_USER_PEER_USERNAME ??= "e2e-peer@example.test"
const localCredentialPath = resolve("config/.e2e-password")
if (!process.env.E2E_USER_ADMIN_PASSWORD && !existsSync(localCredentialPath)) {
  writeFileSync(localCredentialPath, randomBytes(32).toString("base64url"), {
    mode: 0o600,
    flag: "wx",
  })
}
process.env.S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD =
  process.env.E2E_USER_ADMIN_PASSWORD ?? readFileSync(localCredentialPath, "utf8").trim()
process.env.E2E_USER_ADMIN_PASSWORD = process.env.S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD
process.env.E2E_USER_PEER_PASSWORD = process.env.S0_CONFIG_SECRETS_AUTH_ADMIN_PASSWORD

export const appEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      ![
        "CF_AI_GATEWAY_E2E_TOKEN",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        // Process-control metadata from the config-loader/watch process must not reach a new child.
        "NODE_CHANNEL_FD",
        "NODE_CHANNEL_SERIALIZATION_MODE",
        "NODE_UNIQUE_ID",
        "WATCH_REPORT_DEPENDENCIES",
      ].includes(entry[0]),
  ),
)
