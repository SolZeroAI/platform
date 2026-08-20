import { eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { parseJsonArray, stringifyJson } from "../../lib/json"
import { makeD1Drizzle, type D1DrizzleDatabase } from "../../effect/db/d1-drizzle"
import { globalSecrets, repoSecrets } from "../../effect/db/schema"
import { d1Error } from "./errors"

export type RepoSecretBackfillLogEvent =
  | {
      event: "repo_secrets_backfill.attribution"
      repoId: number
      repo: string
      key: string
      attributedUserCount: number
      dryRun: boolean
    }
  | {
      event: "repo_secrets_backfill.skipped"
      repoId: number
      repo: string
      key: string
      reason: "no_attributed_users"
      dryRun: boolean
    }

export type RepoSecretUserResolver = (repo: {
  repoId: number
  repoOwner: string
  repoName: string
}) => Promise<string[]>

type BackfillDrizzle = D1DrizzleDatabase
type RepoSecretRow = typeof repoSecrets.$inferSelect

interface BackfillRowContext {
  row: RepoSecretRow
  drizzle: BackfillDrizzle
  dryRun: boolean
  resolveUserIdsForRepo: RepoSecretUserResolver
  log?: (event: RepoSecretBackfillLogEvent) => void
}

const writeUserGlobalSecret = Effect.fn("db.repoSecretsBackfill.writeUserGlobalSecret")(
  function* (input: {
    drizzle: BackfillDrizzle
    userId: string
    row: RepoSecretRow
    repo: string
    now: number
  }) {
    const scopedKey = `user:${encodeURIComponent(input.userId)}:${input.row.key}`
    const existing = yield* Effect.tryPromise({
      try: () =>
        input.drizzle.select().from(globalSecrets).where(eq(globalSecrets.key, scopedKey)).limit(1),
      catch: d1Error("db.repoSecretsBackfill.writeUserGlobalSecret"),
    }).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])))

    // Preserve the value and replace malformed tag metadata with the repo tag.
    const existingTags = Option.getOrUndefined(Option.map(existing, (row) => row.tags))
    const tags = new Set<string>(
      parseJsonArray(existingTags)
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim()),
    )
    tags.add(`repo:${input.repo}`)
    const tagsJson = stringifyJson([...tags].sort())

    yield* Effect.tryPromise({
      try: () =>
        input.drizzle
          .insert(globalSecrets)
          .values({
            key: scopedKey,
            encryptedValue: Option.getOrElse(
              Option.map(existing, (row) => row.encryptedValue),
              () => input.row.encryptedValue,
            ),
            tags: tagsJson,
            createdAt: Option.getOrElse(
              Option.map(existing, (row) => row.createdAt),
              () => input.row.createdAt,
            ),
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: globalSecrets.key,
            set: {
              tags: tagsJson,
              updatedAt: input.now,
            },
          }),
      catch: d1Error("db.repoSecretsBackfill.writeUserGlobalSecret"),
    })
  },
)

const logSkip = (context: BackfillRowContext, repo: string) =>
  Effect.sync(() => {
    context.log?.({
      event: "repo_secrets_backfill.skipped",
      repoId: context.row.repoId,
      repo,
      key: context.row.key,
      reason: "no_attributed_users",
      dryRun: context.dryRun,
    })
  }).pipe(Effect.map(() => ({ copied: 0, skipped: 1 })))

const performCopies = Effect.fn("db.repoSecretsBackfill.performCopies")(function* (
  context: BackfillRowContext,
  repo: string,
  userIds: readonly string[],
) {
  const now = Date.now()
  // Each userId maps to a distinct scoped key, so the writes can run concurrently.
  yield* Effect.forEach(
    userIds,
    (userId) =>
      writeUserGlobalSecret({ drizzle: context.drizzle, userId, row: context.row, repo, now }),
    { concurrency: "unbounded" },
  )
  return { copied: userIds.length, skipped: 0 }
})

const logAndCopy = Effect.fn("db.repoSecretsBackfill.logAndCopy")(function* (
  context: BackfillRowContext,
  repo: string,
  userIds: readonly string[],
) {
  context.log?.({
    event: "repo_secrets_backfill.attribution",
    repoId: context.row.repoId,
    repo,
    key: context.row.key,
    attributedUserCount: userIds.length,
    dryRun: context.dryRun,
  })

  return yield* Match.value(context.dryRun).pipe(
    Match.when(true, () => Effect.succeed({ copied: userIds.length, skipped: 0 })),
    Match.orElse(() => performCopies(context, repo, userIds)),
  )
})

const processRepoSecretBackfillRow = Effect.fn("db.repoSecretsBackfill.processRow")(function* (
  context: BackfillRowContext,
) {
  const repo = `${context.row.repoOwner}/${context.row.repoName}`
  const resolved = yield* Effect.tryPromise({
    try: () =>
      context.resolveUserIdsForRepo({
        repoId: context.row.repoId,
        repoOwner: context.row.repoOwner,
        repoName: context.row.repoName,
      }),
    catch: d1Error("db.repoSecretsBackfill.resolveUserIds"),
  })
  const userIds = [...new Set(resolved)]

  return yield* Match.value(userIds.length === 0).pipe(
    Match.when(true, () => logSkip(context, repo)),
    Match.orElse(() => logAndCopy(context, repo, userIds)),
  )
})

export const backfillRepoSecretsToUserGlobalSecrets = Effect.fn("db.repoSecretsBackfill.run")(
  function* (input: {
    db: D1Database
    resolveUserIdsForRepo: RepoSecretUserResolver
    dryRun?: boolean
    log?: (event: RepoSecretBackfillLogEvent) => void
  }) {
    const drizzle = makeD1Drizzle(input.db)
    const rows = yield* Effect.tryPromise({
      try: () => drizzle.select().from(repoSecrets),
      catch: d1Error("db.repoSecretsBackfill.listRepoSecrets"),
    })
    const dryRun = input.dryRun ?? true

    // Process rows sequentially: distinct repos can resolve to the same scoped key for the same
    // user, and tag merging reads-then-writes that shared row.
    const rowResults = yield* Effect.forEach(rows, (row) =>
      processRepoSecretBackfillRow({
        row,
        drizzle,
        dryRun,
        resolveUserIdsForRepo: input.resolveUserIdsForRepo,
        log: input.log,
      }),
    )

    return {
      scanned: rows.length,
      copied: rowResults.reduce((total, result) => total + result.copied, 0),
      skipped: rowResults.reduce((total, result) => total + result.skipped, 0),
    }
  },
)
