import { Workspace, WorkspaceFileSystem } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import { getGitHubRepoTool } from "@solzero/shared"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { errorMessageOr } from "../../../lib/effect-errors"
import { buildGitHubAppGitCredentials } from "../git-auth"
import { checkoutIsolateBranch, getCloneBaseBranch } from "../git-branch"
import { REPO_ROOT } from "../repo-paths"
import type { IsolateCloneAuth, IsolateSessionAgentState } from "./types"

export function ensureRepositoryWorkspace(input: {
  workspace: Workspace
  state: IsolateSessionAgentState
  auth?: IsolateCloneAuth
}) {
  return Effect.gen(function* () {
    const repo = getGitHubRepoTool(input.state.tools)
    return yield* Option.match(Option.fromNullishOr(repo), {
      onNone: () => Effect.succeed<{ error?: string }>({}),
      onSome: (resolvedRepo) => prepareRepositoryWorkspaceEffect({ ...input, repo: resolvedRepo }),
    })
  })
}

function prepareRepositoryWorkspaceEffect(input: {
  workspace: Workspace
  state: IsolateSessionAgentState
  repo: NonNullable<ReturnType<typeof getGitHubRepoTool>>
  auth?: IsolateCloneAuth
}) {
  return runRepositoryWorkspacePreparation(input).pipe(
    Effect.map((): { error?: string } => ({})),
    Effect.catch((cause) =>
      Effect.succeed<{ error?: string }>({
        error: `Repository workspace is unavailable in isolate mode: ${errorMessageOr(
          cause,
          `Failed to prepare repository workspace for ${input.repo.repoOwner}/${input.repo.repoName}`,
        )}`,
      }),
    ),
  )
}

function runRepositoryWorkspacePreparation(input: {
  workspace: Workspace
  state: IsolateSessionAgentState
  repo: NonNullable<ReturnType<typeof getGitHubRepoTool>>
  auth?: IsolateCloneAuth
}) {
  return Effect.gen(function* () {
    const filesystem = new WorkspaceFileSystem(input.workspace)
    const git = createGit(filesystem, REPO_ROOT)
    const branchName = input.state.branchName?.trim() || `s0-agent/${input.state.sessionId}`
    const baseBranch = Option.getOrUndefined(
      getCloneBaseBranch({
        repoDefaultBranch: input.state.repoDefaultBranch,
        branchName,
      }),
    )

    const hasGitDir = yield* Effect.tryPromise({
      try: () => input.workspace.exists(`${REPO_ROOT}/.git`),
      catch: (cause) => cause,
    })
    yield* Option.match(
      Option.liftPredicate(hasGitDir, (value) => value === false),
      {
        onNone: () => Effect.void,
        onSome: () => cloneRepository({ ...input, git, branchName, baseBranch }),
      },
    )

    yield* checkoutIsolateBranch({
      workspace: input.workspace,
      git,
      repoRoot: REPO_ROOT,
      branchName,
    })
  })
}

function cloneRepository(input: {
  workspace: Workspace
  repo: NonNullable<ReturnType<typeof getGitHubRepoTool>>
  git: ReturnType<typeof createGit>
  branchName: string
  baseBranch: string | undefined
  auth?: IsolateCloneAuth
}) {
  return Effect.gen(function* () {
    const hasRepoDir = yield* Effect.tryPromise({
      try: () => input.workspace.exists(REPO_ROOT),
      catch: (cause) => cause,
    })
    yield* Option.match(
      Option.liftPredicate(hasRepoDir, (value) => value === true),
      {
        onNone: () => Effect.void,
        onSome: () =>
          Effect.tryPromise({
            try: () => input.workspace.rm(REPO_ROOT, { recursive: true, force: true }),
            catch: (cause) => cause,
          }),
      },
    )

    const accessToken = Option.fromNullishOr(input.auth?.githubAccessToken).pipe(
      Option.filter((token) => token.length > 0),
    )
    const gitAuth = Option.match(accessToken, {
      onNone: () => ({}),
      onSome: (token) => buildGitHubAppGitCredentials(token),
    })
    const cloneBranch = Option.fromNullishOr(input.baseBranch).pipe(
      Option.filter((branch) => branch.length > 0),
    )
    const branchOption = Option.match(cloneBranch, {
      onNone: () => ({}),
      onSome: (branch) => ({ branch }),
    })

    yield* Effect.tryPromise({
      try: () =>
        input.git.clone({
          url: `https://github.com/${input.repo.repoOwner}/${input.repo.repoName}.git`,
          dir: REPO_ROOT,
          depth: 1,
          ...branchOption,
          ...gitAuth,
        }),
      catch: (cause) => cause,
    })
  })
}
