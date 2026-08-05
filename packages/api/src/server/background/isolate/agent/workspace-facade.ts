import { Workspace, WorkspaceFileSystem, type FileInfo } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { getGitHubRepoTool, type PullRequest } from "@solzero/shared"
import { createPullRequestWithInstallationToken } from "../../auth/github-app"
import { checkoutIsolateBranch, hasBranchCommitsBeyondBase } from "../git-branch"
import { buildGitHubAppGitCredentials } from "../git-auth"
import {
  buildSearchExcerpt,
  formatCommitMessage,
  normalizeRepoRelativePath,
  relativeRepoPath,
  REPO_ROOT,
  toRepoPath,
  toRepoWorkspacePath,
} from "../repo-paths"
import {
  buildCapabilities,
  DEFAULT_GLOB_LIMIT,
  DEFAULT_GLOB_PATTERN,
  DEFAULT_SEARCH_LIMIT,
  SESSION_METADATA_PATH,
  type ActiveTurn,
  type IsolateSessionAgentState,
} from "./types"

export interface IsolateWorkspaceHost {
  readonly workspace: Workspace
  readonly state: IsolateSessionAgentState
  readonly activeTurn: ActiveTurn | null
}

/**
 * The parent repository workspace surface exposed over Durable Object RPC to
 * session tooling and awaited sub-agents. The agent class keeps thin
 * RPC-visible delegates; all path mapping, git, and PR logic lives here.
 */
export class IsolateAgentWorkspace {
  constructor(private readonly host: IsolateWorkspaceHost) {}

  private get workspace(): Workspace {
    return this.host.workspace
  }

  async readFile(path: string): Promise<{ path: string; content: string }> {
    this.assertRepoAttached()
    const content = await this.workspace.readFile(toRepoPath(path))
    const resolvedContent = Option.getOrThrowWith(
      Option.fromNullishOr(content),
      () => new Error(`File '${path}' was not found in the repository workspace`),
    )
    return {
      path: normalizeRepoRelativePath(path),
      content: resolvedContent,
    }
  }

  async writeFile(path: string, content: string): Promise<{ path: string; bytes: number }> {
    this.assertRepoAttached()
    await this.workspace.writeFile(toRepoPath(path), content)
    return {
      path: normalizeRepoRelativePath(path),
      bytes: content.length,
    }
  }

  async subagentReadFile(path: string): Promise<string | null> {
    this.assertRepoAttached()
    return this.workspace.readFile(toRepoWorkspacePath(path))
  }

  async subagentReadFileBytes(path: string): Promise<Uint8Array | null> {
    this.assertRepoAttached()
    return this.workspace.readFileBytes(toRepoWorkspacePath(path))
  }

  async subagentWriteFile(path: string, content: string): Promise<void> {
    this.assertRepoAttached()
    await this.workspace.writeFile(toRepoWorkspacePath(path), content)
  }

  async subagentReadDir(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<FileInfo[]> {
    this.assertRepoAttached()
    return this.workspace.readDir(toRepoWorkspacePath(path, { allowRoot: true }), options)
  }

  async subagentRemove(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void> {
    this.assertRepoAttached()
    await this.workspace.rm(toRepoWorkspacePath(path), options)
  }

  async subagentGlob(pattern: string): Promise<FileInfo[]> {
    this.assertRepoAttached()
    return this.workspace.glob(toRepoWorkspacePath(pattern, { allowRoot: true }))
  }

  async subagentMkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertRepoAttached()
    await this.workspace.mkdir(toRepoWorkspacePath(path, { allowRoot: true }), options)
  }

  async subagentStat(path: string): Promise<FileInfo | null> {
    this.assertRepoAttached()
    return this.workspace.stat(toRepoWorkspacePath(path, { allowRoot: true }))
  }

  async glob(pattern = DEFAULT_GLOB_PATTERN, limit = DEFAULT_GLOB_LIMIT): Promise<string[]> {
    this.assertRepoAttached()
    const normalizedPattern = pattern.trim() || DEFAULT_GLOB_PATTERN
    const results = await this.workspace.glob(`${REPO_ROOT}/${normalizedPattern}`)
    return results
      .filter((entry) => entry.type === "file")
      .slice(0, Math.max(1, limit))
      .map((entry) => relativeRepoPath(entry.path))
  }

  async search(
    query: string,
    pattern = DEFAULT_GLOB_PATTERN,
    limit = DEFAULT_SEARCH_LIMIT,
  ): Promise<Array<{ path: string; excerpt: string }>> {
    this.assertRepoAttached()
    const resolvedQuery = Option.getOrThrowWith(
      Option.liftPredicate(query.trim(), (value) => value.length > 0),
      () => new Error("query is required"),
    )

    const files = await this.workspace.glob(
      `${REPO_ROOT}/${pattern.trim() || DEFAULT_GLOB_PATTERN}`,
    )
    const limitCount = Math.max(1, limit)
    const fileEntries = files.filter((entry) => entry.type === "file")

    return fileEntries.reduce<Promise<Array<{ path: string; excerpt: string }>>>(
      (accPromise, entry) =>
        accPromise.then((acc) =>
          Option.match(
            Option.liftPredicate(acc, (current) => current.length < limitCount),
            {
              onNone: () => acc,
              onSome: (current) => this.appendMatch(current, entry.path, resolvedQuery),
            },
          ),
        ),
      Promise.resolve<Array<{ path: string; excerpt: string }>>([]),
    )
  }

  private async appendMatch(
    matches: Array<{ path: string; excerpt: string }>,
    entryPath: string,
    query: string,
  ): Promise<Array<{ path: string; excerpt: string }>> {
    const content = await this.workspace.readFile(entryPath)
    const matched = Option.fromNullishOr(content).pipe(
      Option.filter((value) => value.toLowerCase().includes(query.toLowerCase())),
    )
    return Option.match(matched, {
      onNone: () => matches,
      onSome: (value) => [
        ...matches,
        {
          path: relativeRepoPath(entryPath),
          excerpt: buildSearchExcerpt(value, query),
        },
      ],
    })
  }

  async gitStatus(): Promise<Array<{ filepath: string; status: string }>> {
    this.assertRepoAttached()
    const git = this.createRepoGit()
    const status = await git.status({ dir: REPO_ROOT })
    return status.map((entry) => ({
      filepath: entry.filepath,
      status: entry.status,
    }))
  }

  async gitDiff(): Promise<Array<{ filepath: string; status: string }>> {
    this.assertRepoAttached()
    return this.createRepoGit().diff({ dir: REPO_ROOT })
  }

  async gitLog(depth = 10): Promise<Array<{ oid: string; message: string }>> {
    this.assertRepoAttached()
    const commits = await this.createRepoGit().log({
      depth: Math.max(1, depth),
      dir: REPO_ROOT,
    })
    return commits.map((commit) => ({
      oid: commit.oid,
      message: formatCommitMessage(commit.message),
    }))
  }

  async gitCreatePullRequest(input: {
    title: string
    body?: string
    commitMessage?: string
  }): Promise<PullRequest> {
    this.assertRepoAttached()
    const state = this.host.state
    const repo = Option.getOrThrowWith(
      Option.fromNullishOr(getGitHubRepoTool(state.tools)),
      () => new Error("No repository is attached to this isolate session"),
    )

    const accessToken = Option.fromNullishOr(
      this.host.activeTurn?.auth?.githubAccessToken?.trim(),
    ).pipe(Option.filter((value) => value.length > 0))
    const token = Option.getOrThrowWith(
      accessToken,
      () => new Error("GitHub App installation token is unavailable for this turn"),
    )

    const git = this.createRepoGit()
    const branchName = state.branchName?.trim() || `s0-agent/${state.sessionId}`
    const baseBranch = state.repoDefaultBranch?.trim() || "main"
    Option.getOrThrowWith(
      Option.liftPredicate(branchName, (value) => value !== baseBranch),
      () => new Error(`Refusing to push directly to base branch '${baseBranch}'`),
    )

    // oxlint-disable-next-line effect/effect-run-in-body -- RpcTarget gitCreatePullRequest boundary; runs the isolate branch checkout Effect at the PR-creation edge.
    await Effect.runPromise(
      checkoutIsolateBranch({
        workspace: this.workspace,
        git,
        repoRoot: REPO_ROOT,
        branchName,
      }),
    )

    const status = await git.status({ dir: REPO_ROOT })
    await Match.value(status.length > 0).pipe(
      Match.when(true, () => this.commitChanges(git, input)),
      Match.orElse(() => this.verifyExistingBranchCommits(git, branchName, baseBranch)),
    )

    await git.push({
      dir: REPO_ROOT,
      remote: "origin",
      ref: branchName,
      ...buildGitHubAppGitCredentials(token),
    })

    // oxlint-disable-next-line effect/effect-run-in-body -- RpcTarget gitCreatePullRequest boundary; runs the GitHub App PR creation Effect at the PR-creation edge.
    return Effect.runPromise(
      createPullRequestWithInstallationToken({
        token,
        repoOwner: repo.repoOwner,
        repoName: repo.repoName,
        title: input.title.trim(),
        body: input.body ?? "",
        head: branchName,
        base: baseBranch,
      }),
    )
  }

  async persistSessionMetadata(state: IsolateSessionAgentState): Promise<void> {
    await this.workspace.writeFile(
      SESSION_METADATA_PATH,
      // oxlint-disable-next-line effect/avoid-direct-json -- Pretty-printed (2-space) human-readable session metadata file; the centralized JSON helper only emits compact output, which would change the persisted file contents.
      `${JSON.stringify(
        {
          sessionId: state.sessionId,
          repoOwner: state.repoOwner,
          repoName: state.repoName,
          repoDefaultBranch: state.repoDefaultBranch,
          branchName: state.branchName,
          model: state.model,
          tools: state.tools,
          customMcpServers: state.customMcpServers,
          runtimeStatus: state.runtimeStatus,
          capabilities: buildCapabilities(state),
          lastError: state.lastError,
        },
        null,
        2,
      )}\n`,
    )
  }

  private createRepoGit() {
    return createGit(new WorkspaceFileSystem(this.workspace), REPO_ROOT)
  }

  private async commitChanges(
    git: ReturnType<typeof createGit>,
    input: { title: string; body?: string; commitMessage?: string },
  ): Promise<void> {
    const state = this.host.state
    await git.add({ filepath: ".", dir: REPO_ROOT })
    await git.commit({
      dir: REPO_ROOT,
      message: input.commitMessage?.trim() || input.title.trim(),
      author: {
        name: state.githubName?.trim() || state.userId,
        email: state.githubEmail?.trim() || "s0-agent@noreply.github.com",
      },
    })
  }

  private async verifyExistingBranchCommits(
    git: ReturnType<typeof createGit>,
    branchName: string,
    baseBranch: string,
  ): Promise<void> {
    // oxlint-disable-next-line effect/effect-run-in-body -- RpcTarget gitCreatePullRequest boundary; runs the branch commit-detection Effect at the PR-creation edge.
    const hasCommittedChanges = await Effect.runPromise(
      hasBranchCommitsBeyondBase({
        git,
        repoRoot: REPO_ROOT,
        branchName,
        baseBranch,
      }),
    )
    Option.getOrThrowWith(
      Option.liftPredicate(hasCommittedChanges, (value) => value === true),
      () => new Error("No repository changes are available to commit"),
    )
  }

  private assertRepoAttached(): void {
    Option.getOrThrowWith(
      Option.fromNullishOr(getGitHubRepoTool(this.host.state.tools)),
      () => new Error("No repository is attached to this isolate session"),
    )
  }
}
