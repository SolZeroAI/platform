import { and, asc, eq, isNull, or } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as P from "effect/Predicate"
import * as Result from "effect/Result"
import { parse as parseYaml } from "yaml"
import { runEffectPromise } from "../../lib/effect-promise"
import { stringifyJson } from "../../lib/json"
import { generateId } from "../auth/crypto"
import {
  AgentSkillConflictError,
  AgentSkillNotFoundError,
  AgentSkillValidationError,
  d1Error,
} from "../db/errors"
import { openD1Drizzle } from "../../effect/db/d1-drizzle"
import {
  isControlPlaneDb,
  resolveControlPlaneHandle,
  type AppDrizzleDatabase,
  type AppSchema,
  type ControlPlaneDb,
} from "../../effect/db/control-plane-db"
import { createPullRequestSkillMarkdown, isCreatePullRequestSkillId } from "./built-ins"

const GLOBAL_SKILLS_PREFIX = "global/"
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SKILL_NAME_LENGTH = 64

const TEXT_RESOURCE_EXTENSIONS = new Set([
  ".bash",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
])

export type AgentSkillScope = "global" | "user"

export type AgentSkillRuntimeScope = "harness" | "isolate" | "all"

export type AgentSkillOrigin = "built-in" | "admin" | "skills-sh" | "user"

export interface AgentSkillRecord {
  id: string
  scope: AgentSkillScope
  ownerUserId: string | null
  slug: string
  name: string
  description: string
  runtimeScope: AgentSkillRuntimeScope
  origin: AgentSkillOrigin
  sourceId: string | null
  sourceHash: string | null
  contentHash: string
  defaultEnabled: boolean
  createdByUserId: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface EffectiveAgentSkill extends AgentSkillRecord {
  enabled: boolean
  overridden: boolean
}

export interface ParsedAgentSkillMarkdown {
  name: string
  description: string
  body: string
  rawContent: string
}

export interface RuntimeSkillFile {
  path: string
  content: string
}

export interface RuntimeSkillPackage {
  id: string
  contentHash: string
  name: string
  description: string
  content: string
  files: RuntimeSkillFile[]
}

type AgentSkillRow = AppSchema["agentSkills"]["$inferSelect"]

function rowToRecord(row: AgentSkillRow): AgentSkillRecord {
  return {
    id: row.id,
    scope:
      /* SAFETY: row.scope is persisted only as AgentSkillScope by the writer for that column. */ row.scope as AgentSkillScope,
    ownerUserId: row.ownerUserId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    runtimeScope:
      /* SAFETY: row.runtimeScope is persisted only as AgentSkillRuntimeScope by the writer for that column. */ row.runtimeScope as AgentSkillRuntimeScope,
    origin:
      /* SAFETY: row.origin is persisted only as AgentSkillOrigin by the writer for that column. */ row.origin as AgentSkillOrigin,
    sourceId: row.sourceId,
    sourceHash: row.sourceHash,
    contentHash: row.contentHash,
    defaultEnabled: row.defaultEnabled === 1,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function runtimeScopeCondition(schema: AppSchema, runtimeScope: "harness" | "isolate") {
  return or(
    eq(schema.agentSkills.runtimeScope, runtimeScope),
    eq(schema.agentSkills.runtimeScope, "all"),
  )
}

export class AgentSkillStore {
  private readonly drizzle
  private readonly schema

  constructor(db: AppDrizzleDatabase | ControlPlaneDb) {
    const handle = resolveControlPlaneHandle(db)
    this.drizzle = handle.drizzle
    this.schema = handle.schema
  }

  listActiveGlobal = Effect.fn("db.agentSkills.listActiveGlobal")(function* (
    this: AgentSkillStore,
    runtimeScope?: "harness" | "isolate",
  ) {
    const runtimeFilter = Option.match(Option.fromNullishOr(runtimeScope), {
      onNone: () => undefined,
      onSome: (scope) => runtimeScopeCondition(this.schema, scope),
    })

    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.agentSkills)
          .where(
            and(
              eq(this.schema.agentSkills.scope, "global"),
              isNull(this.schema.agentSkills.deletedAt),
              runtimeFilter,
            ),
          )
          .orderBy(asc(this.schema.agentSkills.name)),
      catch: d1Error("db.agentSkills.listActiveGlobal"),
    })

    return rows.map(rowToRecord)
  })

  listEffectiveGlobal = Effect.fn("db.agentSkills.listEffectiveGlobal")(function* (
    this: AgentSkillStore,
    userId: string,
    runtimeScope: "harness" | "isolate",
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({
            skill: this.schema.agentSkills,
            preferenceEnabled: this.schema.userAgentSkillPreferences.enabled,
          })
          .from(this.schema.agentSkills)
          .leftJoin(
            this.schema.userAgentSkillPreferences,
            and(
              eq(this.schema.userAgentSkillPreferences.skillId, this.schema.agentSkills.id),
              eq(this.schema.userAgentSkillPreferences.userId, userId),
            ),
          )
          .where(
            and(
              eq(this.schema.agentSkills.scope, "global"),
              isNull(this.schema.agentSkills.deletedAt),
              runtimeScopeCondition(this.schema, runtimeScope),
            ),
          )
          .orderBy(asc(this.schema.agentSkills.name)),
      catch: d1Error("db.agentSkills.listEffectiveGlobal"),
    })

    return rows.map(({ skill, preferenceEnabled }): EffectiveAgentSkill => ({
      ...rowToRecord(skill),
      enabled: (preferenceEnabled ?? skill.defaultEnabled) === 1,
      overridden: preferenceEnabled !== null,
    }))
  })

  getActive = Effect.fn("db.agentSkills.getActive")(function* (
    this: AgentSkillStore,
    skillId: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.agentSkills)
          .where(
            and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt)),
          )
          .limit(1),
      catch: d1Error("db.agentSkills.getActive"),
    })

    return Option.map(Option.fromNullishOr(rows[0]), rowToRecord)
  })

  getActiveGlobalBySlug = Effect.fn("db.agentSkills.getActiveGlobalBySlug")(function* (
    this: AgentSkillStore,
    slug: string,
  ) {
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.agentSkills)
          .where(
            and(
              eq(this.schema.agentSkills.scope, "global"),
              eq(this.schema.agentSkills.slug, slug),
              isNull(this.schema.agentSkills.deletedAt),
            ),
          )
          .limit(1),
      catch: d1Error("db.agentSkills.getActiveGlobalBySlug"),
    })

    return Option.map(Option.fromNullishOr(rows[0]), rowToRecord)
  })

  createGlobal = Effect.fn("db.agentSkills.createGlobal")(function* (
    this: AgentSkillStore,
    input: {
      name: string
      description: string
      contentHash: string
      defaultEnabled: boolean
      createdByUserId: string
    },
  ) {
    const existing = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select({ id: this.schema.agentSkills.id })
          .from(this.schema.agentSkills)
          .where(
            and(
              eq(this.schema.agentSkills.scope, "global"),
              eq(this.schema.agentSkills.slug, input.name),
              isNull(this.schema.agentSkills.deletedAt),
            ),
          )
          .limit(1),
      catch: d1Error("db.agentSkills.createGlobal.lookup"),
    })

    yield* Effect.succeed(existing).pipe(
      Effect.filterOrFail(
        (rows) => rows.length === 0,
        () => new AgentSkillConflictError({ message: `Skill '${input.name}' already exists` }),
      ),
    )

    const now = Date.now()
    const id = `skill_${generateId(12)}`
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle.insert(this.schema.agentSkills).values({
          id,
          scope: "global",
          ownerUserId: null,
          slug: input.name,
          name: input.name,
          description: input.description,
          runtimeScope: "harness",
          origin: "admin",
          sourceId: null,
          sourceHash: null,
          contentHash: input.contentHash,
          defaultEnabled: Number(input.defaultEnabled),
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }),
      catch: d1Error("db.agentSkills.createGlobal.insert"),
    })

    return yield* this.requireActive(id)
  })

  setDefaultEnabled = Effect.fn("db.agentSkills.setDefaultEnabled")(function* (
    this: AgentSkillStore,
    skillId: string,
    enabled: boolean,
  ) {
    yield* this.requireActive(skillId)
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.agentSkills)
          .set({ defaultEnabled: Number(enabled), updatedAt: Date.now() })
          .where(
            and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt)),
          ),
      catch: d1Error("db.agentSkills.setDefaultEnabled"),
    })

    return yield* this.requireActive(skillId)
  })

  updateContentHash = Effect.fn("db.agentSkills.updateContentHash")(function* (
    this: AgentSkillStore,
    skillId: string,
    contentHash: string,
  ) {
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .update(this.schema.agentSkills)
          .set({ contentHash, updatedAt: Date.now() })
          .where(
            and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt)),
          ),
      catch: d1Error("db.agentSkills.updateContentHash"),
    })
  })

  setPreference = Effect.fn("db.agentSkills.setPreference")(function* (
    this: AgentSkillStore,
    userId: string,
    skillId: string,
    enabled: boolean,
  ) {
    yield* this.requireActive(skillId).pipe(
      Effect.filterOrFail(
        (skill) => skill.scope === "global" && ["harness", "all"].includes(skill.runtimeScope),
        () => new AgentSkillNotFoundError({ message: "Global harness skill not found" }),
      ),
    )

    const now = Date.now()
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .insert(this.schema.userAgentSkillPreferences)
          .values({
            userId,
            skillId,
            enabled: Number(enabled),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              this.schema.userAgentSkillPreferences.userId,
              this.schema.userAgentSkillPreferences.skillId,
            ],
            set: { enabled: Number(enabled), updatedAt: now },
          }),
      catch: d1Error("db.agentSkills.setPreference"),
    })
  })

  clearPreference = Effect.fn("db.agentSkills.clearPreference")(function* (
    this: AgentSkillStore,
    userId: string,
    skillId: string,
  ) {
    yield* this.requireActive(skillId)
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .delete(this.schema.userAgentSkillPreferences)
          .where(
            and(
              eq(this.schema.userAgentSkillPreferences.userId, userId),
              eq(this.schema.userAgentSkillPreferences.skillId, skillId),
            ),
          ),
      catch: d1Error("db.agentSkills.clearPreference"),
    })
  })

  softDelete = Effect.fn("db.agentSkills.softDelete")(function* (
    this: AgentSkillStore,
    skillId: string,
  ) {
    const skill = yield* this.requireActive(skillId)
    const now = Date.now()
    yield* Effect.tryPromise({
      try: () =>
        this.drizzle.batch([
          this.drizzle
            .update(this.schema.agentSkills)
            .set({ deletedAt: now, updatedAt: now })
            .where(
              and(
                eq(this.schema.agentSkills.id, skillId),
                isNull(this.schema.agentSkills.deletedAt),
              ),
            ),
          this.drizzle
            .delete(this.schema.userAgentSkillPreferences)
            .where(eq(this.schema.userAgentSkillPreferences.skillId, skillId)),
        ]),
      catch: d1Error("db.agentSkills.softDelete"),
    })

    return skill
  })

  requireActive = Effect.fn("db.agentSkills.requireActive")(function* (
    this: AgentSkillStore,
    skillId: string,
  ) {
    const skill = yield* this.getActive(skillId)

    return yield* Option.match(skill, {
      onNone: () =>
        Effect.fail(new AgentSkillNotFoundError({ message: `Skill '${skillId}' not found` })),
      onSome: Effect.succeed,
    })
  })
}

/** Throws the error unless `failed` is exactly false. */
function failWhen(failed: boolean, error: () => Error): void {
  Match.value(failed).pipe(
    Match.when(false, () => undefined),
    Match.orElse(() => {
      throw error()
    }),
  )
}

const skillValidationError = (message: string) => () => new AgentSkillValidationError({ message })

const SKILL_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u

interface SkillMarkdownParts {
  readonly data: Option.Option<{ readonly [key: PropertyKey]: unknown }>
  readonly body: string
}

/** Splits YAML front matter from the body. Front matter that is not a non-array object has no data. */
function splitSkillMarkdown(rawContent: string): SkillMarkdownParts {
  return Option.match(Option.fromNullishOr(SKILL_FRONTMATTER.exec(rawContent)), {
    onNone: () => ({ data: Option.none(), body: rawContent }),
    onSome: (match) => ({
      // SAFETY: YAML front matter is untrusted text parsed into an unknown value. isObject narrows it.
      data: Option.liftPredicate(parseYaml(match[1] ?? "") as unknown, P.isObject),
      body: match[2] ?? "",
    }),
  })
}

function frontmatterText(data: SkillMarkdownParts["data"], key: string): string {
  return data.pipe(
    Option.flatMap((fields) => Option.liftPredicate(fields[key], P.isString)),
    Option.map((value) => value.trim()),
    Option.getOrElse(() => ""),
  )
}

export function parseAgentSkillMarkdown(rawContent: string): ParsedAgentSkillMarkdown {
  const parts = Result.getOrThrowWith(
    Result.try({
      try: () => splitSkillMarkdown(rawContent),
      catch: skillValidationError("SKILL.md frontmatter must be valid YAML"),
    }),
    (error) => error,
  )

  const name = frontmatterText(parts.data, "name")
  const description = frontmatterText(parts.data, "description")

  failWhen(
    !name || !description,
    skillValidationError("SKILL.md must contain valid YAML frontmatter with name and description"),
  )

  const body = parts.body.trim()

  failWhen(
    !SKILL_NAME_PATTERN.test(name) || name.length > MAX_SKILL_NAME_LENGTH,
    skillValidationError(
      "Skill name must be 1-64 lowercase letters, numbers, or hyphen-separated words",
    ),
  )
  failWhen(!description, skillValidationError("Skill description is required"))
  failWhen(!body, skillValidationError("Skill instructions are required"))

  return { name, description, body, rawContent }
}

export function validateSkillResourcePath(path: string): string {
  const normalized = path.trim()
  const parts = normalized.split("/")

  failWhen(
    !normalized ||
      normalized.startsWith("/") ||
      normalized.includes("\\") ||
      normalized.includes("\0") ||
      parts.some((part) => !part || part === "." || part === ".."),
    skillValidationError(`Unsafe skill resource path '${path}'`),
  )

  return normalized
}

function validateTextSkillResourcePath(path: string): string {
  const normalized = validateSkillResourcePath(path)
  const filename = normalized.split("/").at(-1) ?? normalized

  const extension = Option.liftPredicate(filename.lastIndexOf("."), (index) => index >= 0).pipe(
    Option.map((index) => filename.slice(index).toLowerCase()),
    Option.getOrElse(() => ""),
  )

  failWhen(
    !TEXT_RESOURCE_EXTENSIONS.has(extension),
    skillValidationError(`Skill resource '${path}' is not a supported text file`),
  )

  return normalized
}

export function globalSkillPrefix(slug: string): string {
  return `${GLOBAL_SKILLS_PREFIX}${slug}/`
}

export function globalSkillMarkdownKey(slug: string): string {
  return `${globalSkillPrefix(slug)}SKILL.md`
}

export async function hashSkillContent(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function writeGlobalSkillMarkdown(
  bucket: R2Bucket,
  slug: string,
  content: string,
): Promise<void> {
  await bucket.put(globalSkillMarkdownKey(slug), content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  })
}

function nextR2Cursor(page: R2Objects): Option.Option<string> {
  return Match.value(page).pipe(
    Match.when({ truncated: true }, (more) =>
      Option.liftPredicate(more.cursor, (cursor) => cursor.length > 0),
    ),
    Match.orElse(() => Option.none()),
  )
}

async function listObjectsFrom(
  bucket: R2Bucket,
  prefix: string,
  cursor?: string,
): Promise<R2Object[]> {
  const page = await bucket.list({ prefix, cursor })

  return Option.match(nextR2Cursor(page), {
    onNone: () => page.objects,
    onSome: async (next) => [...page.objects, ...(await listObjectsFrom(bucket, prefix, next))],
  })
}

async function listAllObjects(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects = await listObjectsFrom(bucket, prefix)

  return objects.sort((left, right) => left.key.localeCompare(right.key))
}

export async function deleteGlobalSkillPackage(bucket: R2Bucket, slug: string): Promise<void> {
  const keys = (await listAllObjects(bucket, globalSkillPrefix(slug))).map((object) => object.key)

  await Match.value(keys.length > 0).pipe(
    Match.when(true, () => bucket.delete(keys)),
    Match.orElse(() => Promise.resolve()),
  )
}

async function readGlobalSkillMarkdown(
  bucket: R2Bucket,
  slug: string,
): Promise<Option.Option<string>> {
  const object = await bucket.get(globalSkillMarkdownKey(slug))

  return Option.match(Option.fromNullishOr(object), {
    onNone: () => Option.none<string>(),
    onSome: async (body) => Option.some(await body.text()),
  })
}

function skillStore(db: D1Database | ControlPlaneDb): AgentSkillStore {
  return new AgentSkillStore(
    Match.value(db).pipe(
      Match.when(isControlPlaneDb, (controlPlane) => controlPlane),
      Match.orElse((d1) => openD1Drizzle(d1)),
    ),
  )
}

async function refreshBuiltInPackage(
  store: AgentSkillStore,
  bucket: R2Bucket,
  skill: AgentSkillRecord,
  brandName: string,
  command: string,
): Promise<AgentSkillRecord> {
  const expected = createPullRequestSkillMarkdown({ skillName: skill.name, brandName, command })
  const existing = await readGlobalSkillMarkdown(bucket, skill.slug)
  const contentHash = await hashSkillContent(expected)

  await Match.value(Option.exists(existing, (content) => content === expected)).pipe(
    Match.when(true, () => Promise.resolve()),
    Match.orElse(() => writeGlobalSkillMarkdown(bucket, skill.slug, expected)),
  )

  return Match.value(skill.contentHash === contentHash).pipe(
    Match.when(true, () => Promise.resolve(skill)),
    Match.orElse(() =>
      runEffectPromise(store.updateContentHash(skill.id, contentHash)).then(() => ({
        ...skill,
        contentHash,
        updatedAt: Date.now(),
      })),
    ),
  )
}

async function ensureBuiltInPackage(
  store: AgentSkillStore,
  bucket: R2Bucket,
  skill: AgentSkillRecord,
  brandName: string,
  command: string,
): Promise<AgentSkillRecord> {
  return Match.value(isCreatePullRequestSkillId(skill.id) && skill.origin === "built-in").pipe(
    Match.when(true, () => refreshBuiltInPackage(store, bucket, skill, brandName, command)),
    Match.orElse(() => Promise.resolve(skill)),
  )
}

async function loadSkillResource(
  bucket: R2Bucket,
  prefix: string,
  object: R2Object,
): Promise<RuntimeSkillFile> {
  const path = validateTextSkillResourcePath(object.key.slice(prefix.length))

  const body = Option.getOrThrowWith(
    Option.fromNullishOr(await bucket.get(object.key)),
    skillValidationError(`Skill resource '${object.key}' disappeared while loading`),
  )

  return { path, content: await body.text() }
}

export async function loadRuntimeSkillPackage(
  bucket: R2Bucket,
  skill: AgentSkillRecord,
): Promise<RuntimeSkillPackage> {
  const rawContent = Option.getOrThrowWith(
    Option.filter(
      await readGlobalSkillMarkdown(bucket, skill.slug),
      (content) => content.length > 0,
    ),
    skillValidationError(`Skill '${skill.name}' is missing ${globalSkillMarkdownKey(skill.slug)}`),
  )

  const parsed = parseAgentSkillMarkdown(rawContent)

  failWhen(
    parsed.name !== skill.name,
    skillValidationError(`Skill '${skill.name}' frontmatter name does not match its catalog entry`),
  )

  const prefix = globalSkillPrefix(skill.slug)

  const files = await Promise.all(
    (await listAllObjects(bucket, prefix))
      .filter((object) => object.key !== globalSkillMarkdownKey(skill.slug))
      .map((object) => loadSkillResource(bucket, prefix, object)),
  )

  return {
    id: skill.id,
    contentHash: await hashSkillContent(
      stringifyJson({ rawContent, files: files.map((file) => [file.path, file.content]) }),
    ),
    name: parsed.name,
    description: parsed.description,
    content: parsed.body,
    files,
  }
}

/** Puts back the SKILL.md that was there before a failed create. Cleanup errors are ignored. */
function restoreSkillPackage(
  bucket: R2Bucket,
  slug: string,
  previous: Option.Option<string>,
): Promise<void> {
  return Option.match(previous, {
    onNone: () => deleteGlobalSkillPackage(bucket, slug),
    onSome: (content) => writeGlobalSkillMarkdown(bucket, slug, content),
  }).catch(() => undefined)
}

export async function createAdminGlobalSkill(input: {
  db: D1Database | ControlPlaneDb
  bucket: R2Bucket
  skillMd: string
  defaultEnabled: boolean
  adminUserId: string
}): Promise<AgentSkillRecord> {
  const parsed = parseAgentSkillMarkdown(input.skillMd)
  const contentHash = await hashSkillContent(input.skillMd)
  const store = skillStore(input.db)
  const existing = await runEffectPromise(store.getActiveGlobalBySlug(parsed.name))

  failWhen(
    Option.isSome(existing),
    () => new AgentSkillConflictError({ message: `Skill '${parsed.name}' already exists` }),
  )

  const previousPackage = await readGlobalSkillMarkdown(input.bucket, parsed.name)
  await writeGlobalSkillMarkdown(input.bucket, parsed.name, input.skillMd)

  return runEffectPromise(
    store.createGlobal({
      name: parsed.name,
      description: parsed.description,
      contentHash,
      defaultEnabled: input.defaultEnabled,
      createdByUserId: input.adminUserId,
    }),
  ).catch((error: unknown) =>
    restoreSkillPackage(input.bucket, parsed.name, previousPackage).then(() =>
      Promise.reject(error),
    ),
  )
}

export async function resolveRuntimeSkillPackages(input: {
  brandName: string
  createPullRequestCommand: string
  db: D1Database | ControlPlaneDb
  bucket: R2Bucket
  userId: string
}): Promise<RuntimeSkillPackage[]> {
  const store = skillStore(input.db)
  const effective = await runEffectPromise(store.listEffectiveGlobal(input.userId, "harness"))

  return Promise.all(
    effective
      .filter((skill) => skill.enabled)
      .map(async (skill) =>
        loadRuntimeSkillPackage(
          input.bucket,
          await ensureBuiltInPackage(
            store,
            input.bucket,
            skill,
            input.brandName,
            input.createPullRequestCommand,
          ),
        ),
      ),
  )
}

export async function listEffectiveGlobalSkills(input: {
  db: D1Database | ControlPlaneDb
  userId: string
}): Promise<EffectiveAgentSkill[]> {
  return runEffectPromise(skillStore(input.db).listEffectiveGlobal(input.userId, "harness"))
}

export async function listAdminGlobalSkills(
  db: D1Database | ControlPlaneDb,
): Promise<AgentSkillRecord[]> {
  return runEffectPromise(skillStore(db).listActiveGlobal("harness"))
}

export async function listIsolateGlobalSkillNames(input: {
  db: D1Database | ControlPlaneDb
  userId: string
}): Promise<string[]> {
  const effective = await runEffectPromise(
    skillStore(input.db).listEffectiveGlobal(input.userId, "isolate"),
  )

  return effective.filter((skill) => skill.enabled).map((skill) => skill.name)
}
