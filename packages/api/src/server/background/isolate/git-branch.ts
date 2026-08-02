import type { Workspace } from "@cloudflare/shell"
import type { Git } from "@cloudflare/shell/git"
import { posix as pathPosix } from "node:path"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { toError } from "../../lib/effect-errors"

interface CheckoutIsolateBranchInput {
  workspace: Workspace
  git: Git
  repoRoot: string
  branchName: string
}

type GitBranchResult = Awaited<ReturnType<Git["branch"]>>

function attempt<A>(thunk: () => Promise<A>) {
  return Effect.tryPromise({ try: thunk, catch: toError })
}

function getCurrentBranch(branches: GitBranchResult): Option.Option<string> {
  return Option.fromNullishOr(branches.current).pipe(
    Option.filter((value): value is string => typeof value === "string"),
  )
}

function getBranchNames(branches: GitBranchResult): readonly string[] {
  return branches.branches ?? []
}

function checkoutExistingBranch(input: CheckoutIsolateBranchInput) {
  return Effect.asVoid(
    attempt(() => input.git.checkout({ ref: input.branchName, dir: input.repoRoot })),
  )
}

function createIsolateBranch(
  input: CheckoutIsolateBranchInput,
  currentBranch: Option.Option<string>,
) {
  return Effect.gen(function* () {
    const commits = yield* attempt(() =>
      input.git.log({
        depth: 1,
        ref: Option.getOrElse(currentBranch, () => "HEAD"),
        dir: input.repoRoot,
      }),
    )
    const headCommit = yield* Option.match(Arr.head(commits), {
      onNone: () =>
        Effect.fail(
          toError(`Cannot create isolate branch '${input.branchName}' without a HEAD commit`),
        ),
      onSome: (commit) => Effect.succeed(commit),
    })

    const branchRefPath = `${input.repoRoot}/.git/refs/heads/${input.branchName}`
    yield* attempt(() =>
      input.workspace.mkdir(pathPosix.dirname(branchRefPath), {
        recursive: true,
      }),
    )
    yield* attempt(() => input.workspace.writeFile(branchRefPath, `${headCommit.oid}\n`))
    yield* attempt(() =>
      input.workspace.writeFile(
        `${input.repoRoot}/.git/HEAD`,
        `ref: refs/heads/${input.branchName}\n`,
      ),
    )
  })
}

export function checkoutIsolateBranch(input: CheckoutIsolateBranchInput) {
  return Effect.gen(function* () {
    const branches = yield* attempt(() => input.git.branch({ list: true, dir: input.repoRoot }))
    const currentBranch = getCurrentBranch(branches)
    const branchNames = getBranchNames(branches)

    const action = Match.value({
      alreadyOnBranch: Option.exists(currentBranch, (name) => name === input.branchName),
      hasLocalBranch: branchNames.includes(input.branchName),
    }).pipe(
      Match.when({ alreadyOnBranch: true }, () => "noop" as const),
      Match.when({ hasLocalBranch: true }, () => "checkout" as const),
      Match.orElse(() => "create" as const),
    )

    const branchAction = Match.value(action).pipe(
      Match.when("checkout", () => checkoutExistingBranch(input)),
      Match.orElse(() => createIsolateBranch(input, currentBranch)),
    )
    const shouldChangeBranch = Effect.succeed(action !== "noop")
    yield* Effect.when(branchAction, shouldChangeBranch)
  })
}

export function getCloneBaseBranch(input: {
  repoDefaultBranch?: string | null
  branchName: string
}): Option.Option<string> {
  return Option.fromNullishOr(input.repoDefaultBranch?.trim()).pipe(
    Option.filter((branch) => branch.length > 0 && branch !== input.branchName),
  )
}

function compareBaseHead(
  input: { git: Git; repoRoot: string; baseBranch: string },
  branchOid: string,
) {
  return attempt(() =>
    input.git.log({ depth: 1, ref: input.baseBranch, dir: input.repoRoot }),
  ).pipe(
    Effect.map((baseCommits) =>
      Option.match(Arr.head(baseCommits), {
        onNone: () => true,
        onSome: (baseHead) => branchOid !== baseHead.oid,
      }),
    ),
    Effect.catch(() => Effect.succeed(true)),
  )
}

export function hasBranchCommitsBeyondBase(input: {
  git: Git
  repoRoot: string
  branchName: string
  baseBranch: string
}) {
  return Effect.gen(function* () {
    const branchCommits = yield* attempt(() =>
      input.git.log({ depth: 1, ref: input.branchName, dir: input.repoRoot }),
    )
    return yield* Option.match(Arr.head(branchCommits), {
      onNone: () => Effect.succeed(false),
      onSome: (branchHead) => compareBaseHead(input, branchHead.oid),
    })
  })
}
