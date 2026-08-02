import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import dotenv from "dotenv"

const defaultConfig = {
  preVarsPath: "config/.pre.vars",
  prodVarsPath: "config/.prod.vars",
  infraEnvPath: "config/.env",
}

const githubSecretNameMap: Record<string, string> = {
  GITHUB_APP_CLIENT_SECRET: "GH_APP_CLIENT_SECRET",
  GITHUB_APP_PRIVATE_KEY: "GH_APP_PRIVATE_KEY",
  GITHUB_APP_WEBHOOK_SECRET: "GH_APP_WEBHOOK_SECRET",
}

const repoSecretNames = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CF_AI_SEARCH_SERVICE_TOKEN_ID",
] as const
const repoSecretNameSet = new Set<string>(repoSecretNames)

interface Args {
  repo: string
  preVarsPath: string
  prodVarsPath: string
  infraEnvPath: string
  apply: boolean
  syncRuntime: boolean
  syncInfra: boolean
  useGitHubTokenEnv: boolean
}

interface SecretUpload {
  scope: "environment" | "repository"
  name: string
  value: string
  environment?: string
  sourceName?: string
}

function usage(): string {
  return `Usage: nub run github:sync-env-secrets -- --repo <owner/repo> [options]

Sync local dotenv files to GitHub Actions secrets for an explicitly selected repository.
Runs as a dry-run unless --apply is provided.

Options:
  --apply                  Write secrets to GitHub. Default is dry-run.
  --repo <owner/repo>       GitHub repository. Required.
  --pre-vars <path>         Preview runtime vars file. Default: ${defaultConfig.preVarsPath}
  --prod-vars <path>        Production runtime vars file. Default: ${defaultConfig.prodVarsPath}
  --infra-env <path>        Repo-level infra env file. Default: ${defaultConfig.infraEnvPath}
  --runtime-only            Sync only pre/prod environment secrets.
  --infra-only              Sync only repo-level infra secrets.
  --use-github-token-env    Preserve GITHUB_TOKEN when invoking gh.
  --help                    Show this help.

Notes:
  - GITHUB_APP_* values are uploaded as GH_APP_* because GitHub rejects secret names
    beginning with GITHUB_.
  - Secret values are sent to gh over stdin and are never printed.
  - By default this script removes GITHUB_TOKEN from child gh commands so a stale
    local environment token does not override keychain auth. GH_TOKEN is preserved.`
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    repo: "",
    preVarsPath: defaultConfig.preVarsPath,
    prodVarsPath: defaultConfig.prodVarsPath,
    infraEnvPath: defaultConfig.infraEnvPath,
    apply: false,
    syncRuntime: true,
    syncInfra: true,
    useGitHubTokenEnv: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    switch (arg) {
      case "--":
        break
      case "--apply":
        args.apply = true
        break
      case "--repo":
        args.repo = readOptionValue(argv, ++i, arg)
        break
      case "--pre-vars":
        args.preVarsPath = readOptionValue(argv, ++i, arg)
        break
      case "--prod-vars":
        args.prodVarsPath = readOptionValue(argv, ++i, arg)
        break
      case "--infra-env":
        args.infraEnvPath = readOptionValue(argv, ++i, arg)
        break
      case "--runtime-only":
        args.syncRuntime = true
        args.syncInfra = false
        break
      case "--infra-only":
        args.syncRuntime = false
        args.syncInfra = true
        break
      case "--use-github-token-env":
        args.useGitHubTokenEnv = true
        break
      case "--help":
      case "-h":
        console.log(usage())
        process.exit(0)
      default:
        throw new Error(`Unknown option: ${arg}\n\n${usage()}`)
    }
  }

  return args
}

function readOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parseDotenvFile(path: string): Record<string, string> {
  return dotenv.parse(readFileSync(path))
}

function mappedSecretName(name: string): string {
  return githubSecretNameMap[name] ?? name
}

function runtimeUploads(environment: string, path: string): SecretUpload[] {
  const parsed = parseDotenvFile(path)

  return Object.entries(parsed).flatMap(([sourceName, value]) => {
    if (repoSecretNameSet.has(sourceName)) {
      return []
    }
    if (!value) {
      throw new Error(`${path}: ${sourceName} is empty; refusing to upload an empty GitHub secret`)
    }
    return [
      {
        scope: "environment" as const,
        environment,
        sourceName,
        name: mappedSecretName(sourceName),
        value,
      },
    ]
  })
}

function infraUploads(path: string): SecretUpload[] {
  const parsed = parseDotenvFile(path)

  return repoSecretNames.flatMap((name) => {
    const value = parsed[name]
    if (!value) {
      return []
    }

    return [
      {
        scope: "repository",
        name,
        value,
      },
    ]
  })
}

function childEnv(useGitHubTokenEnv: boolean): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (!useGitHubTokenEnv) {
    delete env.GITHUB_TOKEN
  }
  return env
}

function runGh(args: string[], options: { input?: string; useGitHubTokenEnv: boolean }): void {
  const result = spawnSync("gh", args, {
    input: options.input,
    encoding: "utf8",
    env: childEnv(options.useGitHubTokenEnv),
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim()
    const stdout = result.stdout.trim()
    throw new Error([stderr, stdout].filter(Boolean).join("\n"))
  }
}

function ensureEnvironment(repo: string, environment: string, useGitHubTokenEnv: boolean): void {
  runGh(["api", "-X", "PUT", `repos/${repo}/environments/${environment}`, "--silent"], {
    useGitHubTokenEnv,
  })
}

function setSecret(repo: string, upload: SecretUpload, useGitHubTokenEnv: boolean): void {
  const args =
    upload.scope === "environment"
      ? [
          "secret",
          "set",
          upload.name,
          "--env",
          upload.environment ?? "",
          "--repo",
          repo,
          "--app",
          "actions",
        ]
      : ["secret", "set", upload.name, "--repo", repo, "--app", "actions"]

  runGh(args, {
    input: upload.value,
    useGitHubTokenEnv,
  })
}

function describeUpload(upload: SecretUpload): string {
  const target =
    upload.scope === "environment" ? `${upload.environment}:${upload.name}` : `repo:${upload.name}`

  if (upload.sourceName && upload.sourceName !== upload.name) {
    return `${target} (from ${upload.sourceName})`
  }

  return target
}

function printPlan(uploads: SecretUpload[], apply: boolean): void {
  const title = apply ? "Syncing GitHub secrets" : "Dry-run GitHub secret sync"
  console.log(title)
  console.log("")

  if (uploads.length > 0) {
    console.log("Set/update:")
  }
  for (const upload of uploads) {
    console.log(`- ${describeUpload(upload)}`)
  }

  console.log("")
  console.log(`${uploads.length} secrets ${apply ? "selected" : "would be synced"}.`)
  if (!apply) {
    console.log("Pass --apply to write these secrets to GitHub.")
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  if (!/^[^/\s]+\/[^/\s]+$/.test(args.repo)) {
    throw new Error("--repo <owner/repo> is required and must identify the GitHub destination")
  }
  const uploads: SecretUpload[] = []

  if (args.syncRuntime) {
    uploads.push(...runtimeUploads("pre", args.preVarsPath))
    uploads.push(...runtimeUploads("prod", args.prodVarsPath))
  }

  if (args.syncInfra) {
    uploads.push(...infraUploads(args.infraEnvPath))
  }

  printPlan(uploads, args.apply)

  if (!args.apply) {
    return
  }

  if (args.syncRuntime) {
    ensureEnvironment(args.repo, "pre", args.useGitHubTokenEnv)
    ensureEnvironment(args.repo, "prod", args.useGitHubTokenEnv)
  }

  for (const upload of uploads) {
    setSecret(args.repo, upload, args.useGitHubTokenEnv)
    console.log(`set ${describeUpload(upload)}`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
