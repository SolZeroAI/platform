import { chmod, mkdir, writeFile } from "node:fs/promises"
import { WORKSPACE_ROOT } from "./local-sandbox"
import type { RuntimeInitRequest } from "./types"

const GIT_ASKPASS_PATH = "/root/.c0-git-askpass.sh"
const GIT_TOKEN_PATH = "/root/.c0-git-token"
const CREATE_PR_SCRIPT_PATH = "/usr/local/bin/c0-create-pr"

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function run(command: string, options: { cwd?: string; env?: Record<string, string> } = {}) {
  const { spawn } = await import("node:child_process")
  const child = spawn(command, {
    cwd: options.cwd ?? WORKSPACE_ROOT,
    env: {
      ...process.env,
      ...options.env,
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const [stdout, stderr, result] = await Promise.all([
    streamToString(child.stdout),
    streamToString(child.stderr),
    new Promise<{ exitCode: number }>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code) => resolve({ exitCode: code ?? 0 }))
    }),
  ])
  return { stdout, stderr, exitCode: result.exitCode } satisfies CommandResult
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function assertSuccess(result: CommandResult, action: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${action} failed: ${result.stderr || result.stdout}`)
  }
}

function githubCloneUrl(input: RuntimeInitRequest): string | null {
  if (!input.repoOwner || !input.repoName) {
    return null
  }
  return `https://github.com/${input.repoOwner}/${input.repoName}.git`
}

function gitAuthEnvironment(): Record<string, string> {
  return {
    GIT_ASKPASS: GIT_ASKPASS_PATH,
    GIT_TERMINAL_PROMPT: "0",
  }
}

async function configureGitCredentials(input: RuntimeInitRequest): Promise<void> {
  if (!input.githubAccessToken) {
    return
  }
  await writeFile(GIT_TOKEN_PATH, input.githubAccessToken, { mode: 0o600 })
  await writeFile(
    GIT_ASKPASS_PATH,
    [
      "#!/bin/sh",
      'case "$1" in',
      '  *Username*) printf "%s\\n" "x-access-token" ;;',
      `  *Password*) cat ${shellQuote(GIT_TOKEN_PATH)} ;;`,
      '  *) printf "\\n" ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o700 },
  )
  process.env.GITHUB_TOKEN = input.githubAccessToken
  process.env.GH_TOKEN = input.githubAccessToken
}

async function hasGitRepository(): Promise<boolean> {
  const result = await run("git rev-parse --is-inside-work-tree")
  return result.exitCode === 0 && result.stdout.trim() === "true"
}

async function cloneRepository(input: RuntimeInitRequest): Promise<void> {
  const url = githubCloneUrl(input)
  if (url === null) {
    return
  }
  const result = await run(`git clone ${shellQuote(url)} ${shellQuote(WORKSPACE_ROOT)}`, {
    cwd: "/",
    env: gitAuthEnvironment(),
  })
  assertSuccess(result, "git clone")
}

async function configureGitUser(input: RuntimeInitRequest): Promise<void> {
  if (input.githubAccessToken) {
    assertSuccess(
      await run(`git config --local core.askPass ${shellQuote(GIT_ASKPASS_PATH)}`),
      "git config core.askPass",
    )
    assertSuccess(
      await run("git config --local credential.username x-access-token"),
      "git config credential.username",
    )
  }
  const name = input.githubName || input.githubLogin
  if (name) {
    assertSuccess(await run(`git config user.name ${shellQuote(name)}`), "git config user.name")
  }
  if (input.githubEmail) {
    assertSuccess(
      await run(`git config user.email ${shellQuote(input.githubEmail)}`),
      "git config user.email",
    )
  }
}

async function checkoutBranch(input: RuntimeInitRequest): Promise<void> {
  const branch = input.branchName
  if (!branch) {
    return
  }
  const remoteBranch = `origin/${branch}`
  const fetch = await run("git fetch --all --prune", { env: gitAuthEnvironment() })
  if (fetch.exitCode !== 0) {
    return
  }
  const exists = await run(`git rev-parse --verify ${shellQuote(remoteBranch)}`)
  if (exists.exitCode === 0) {
    assertSuccess(
      await run(`git checkout -B ${shellQuote(branch)} ${shellQuote(remoteBranch)}`),
      "git checkout",
    )
    return
  }
  const base = input.repoDefaultBranch ? `origin/${input.repoDefaultBranch}` : "HEAD"
  assertSuccess(
    await run(`git checkout -B ${shellQuote(branch)} ${shellQuote(base)}`),
    "git checkout",
  )
}

async function writeCreatePullRequestScript(input: RuntimeInitRequest): Promise<void> {
  if (!input.repoOwner || !input.repoName || !input.githubAccessToken) {
    return
  }
  const baseBranch = input.repoDefaultBranch?.trim() || "main"
  const defaultBranch = input.branchName?.trim() || `c0-agent/${input.sessionId}`
  await writeFile(
    CREATE_PR_SCRIPT_PATH,
    [
      "#!/bin/sh",
      "set -eu",
      `REPO_OWNER=${shellQuote(input.repoOwner)}`,
      `REPO_NAME=${shellQuote(input.repoName)}`,
      `BASE_BRANCH=${shellQuote(baseBranch)}`,
      `DEFAULT_BRANCH=${shellQuote(defaultBranch)}`,
      `TOKEN_FILE=${shellQuote(GIT_TOKEN_PATH)}`,
      'TITLE="${1:-c0 agent changes}"',
      'BODY="${2:-Created by c0 agent.}"',
      'BRANCH="$(git branch --show-current 2>/dev/null || true)"',
      'if [ -z "$BRANCH" ]; then BRANCH="$DEFAULT_BRANCH"; fi',
      'if [ "$BRANCH" = "$BASE_BRANCH" ]; then',
      '  echo "Refusing to push directly to base branch $BASE_BRANCH" >&2',
      "  exit 1",
      "fi",
      'git push -u origin "HEAD:refs/heads/$BRANCH"',
      'TOKEN="$(cat "$TOKEN_FILE")"',
      "export TOKEN REPO_OWNER REPO_NAME TITLE BODY BRANCH BASE_BRANCH",
      "node - <<'NODE'",
      "const response = await fetch(`https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/pulls`, {",
      "  method: 'POST',",
      "  headers: {",
      "    Authorization: `Bearer ${process.env.TOKEN}` ,",
      "    Accept: 'application/vnd.github+json',",
      "    'X-GitHub-Api-Version': '2022-11-28',",
      "    'User-Agent': 'c0-agent',",
      "    'Content-Type': 'application/json',",
      "  },",
      "  body: JSON.stringify({",
      "    title: process.env.TITLE,",
      "    body: process.env.BODY,",
      "    head: process.env.BRANCH,",
      "    base: process.env.BASE_BRANCH,",
      "  }),",
      "});",
      "const text = await response.text();",
      "if (!response.ok) { console.error(text); process.exit(1); }",
      "console.log(JSON.parse(text).html_url);",
      "NODE",
      "",
    ].join("\n"),
  )
  await chmod(CREATE_PR_SCRIPT_PATH, 0o700)
}

export async function initializeWorkspace(input: RuntimeInitRequest): Promise<void> {
  await mkdir(WORKSPACE_ROOT, { recursive: true })
  await configureGitCredentials(input)
  const repositoryExists = await hasGitRepository()
  if (!repositoryExists) {
    await cloneRepository(input)
  }
  if (await hasGitRepository()) {
    await configureGitUser(input)
    await checkoutBranch(input)
    await writeCreatePullRequestScript(input)
  }
}
