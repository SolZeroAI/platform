/* oxlint-disable s0-lint/no-if-statement, s0-lint/no-ternary, s0-lint/no-return-in-arrow, s0-lint/no-return-in-callback, s0-lint/prefer-option-over-null, effect/avoid-direct-json, effect/avoid-try-catch, effect/effect-run-in-body, effect/imperative-loops -- This module is the D1, R2, and untrusted SKILL.md package boundary; explicit validation, pagination, compensation, and cleanup ordering stay local and imperative. */
import { and, asc, eq, isNull, or } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { parse as parseYaml } from "yaml"
import { generateId } from "../auth/crypto"
import {
  AgentSkillConflictError,
  AgentSkillNotFoundError,
  AgentSkillValidationError,
  d1Error,
} from "../db/errors"
import { makeD1Drizzle } from "../../effect/db/d1-drizzle"
import {
  resolveControlPlaneHandle,
  type AppDrizzleDatabase,
  type AppSchema,
  type ControlPlaneDb,
} from "../../effect/db/control-plane-db"
import { S0_CREATE_PR_SKILL_ID, S0_CREATE_PR_SKILL_MD } from "./built-ins"

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
    scope: row.scope as AgentSkillScope,
    ownerUserId: row.ownerUserId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    runtimeScope: row.runtimeScope as AgentSkillRuntimeScope,
    origin: row.origin as AgentSkillOrigin,
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
  return or(eq(schema.agentSkills.runtimeScope, runtimeScope), eq(schema.agentSkills.runtimeScope, "all"))
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
    const runtimeFilter = runtimeScope ? runtimeScopeCondition(this.schema, runtimeScope) : undefined
    const rows = yield* Effect.tryPromise({
      try: () =>
        this.drizzle
          .select()
          .from(this.schema.agentSkills)
          .where(and(eq(this.schema.agentSkills.scope, "global"), isNull(this.schema.agentSkills.deletedAt), runtimeFilter))
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
    return rows.map(
      ({ skill, preferenceEnabled }): EffectiveAgentSkill => ({
        ...rowToRecord(skill),
        enabled: (preferenceEnabled ?? skill.defaultEnabled) === 1,
        overridden: preferenceEnabled !== null,
      }),
    )
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
          .where(and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt)))
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
    if (existing.length > 0) {
      return yield* Effect.fail(
        new AgentSkillConflictError({ message: `Skill '${input.name}' already exists` }),
      )
    }

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
          .where(and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt))),
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
          .where(and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt))),
      catch: d1Error("db.agentSkills.updateContentHash"),
    })
  })

  setPreference = Effect.fn("db.agentSkills.setPreference")(function* (
    this: AgentSkillStore,
    userId: string,
    skillId: string,
    enabled: boolean,
  ) {
    const skill = yield* this.requireActive(skillId)
    if (skill.scope !== "global" || !["harness", "all"].includes(skill.runtimeScope)) {
      return yield* Effect.fail(
        new AgentSkillNotFoundError({ message: "Global harness skill not found" }),
      )
    }
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
            target: [this.schema.userAgentSkillPreferences.userId, this.schema.userAgentSkillPreferences.skillId],
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
            .where(and(eq(this.schema.agentSkills.id, skillId), isNull(this.schema.agentSkills.deletedAt))),
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

export function parseAgentSkillMarkdown(rawContent: string): ParsedAgentSkillMarkdown {
  let data: Record<string, unknown> | null
  let body: string
  try {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(rawContent)
    if (!match) {
      data = null
      body = rawContent
    } else {
      const value = parseYaml(match[1] ?? "") as unknown
      data =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null
      body = match[2] ?? ""
    }
  } catch {
    throw new AgentSkillValidationError({ message: "SKILL.md frontmatter must be valid YAML" })
  }
  const name = typeof data?.name === "string" ? data.name.trim() : ""
  const description = typeof data?.description === "string" ? data.description.trim() : ""
  if (!name || !description) {
    throw new AgentSkillValidationError({
      message: "SKILL.md must contain valid YAML frontmatter with name and description",
    })
  }
  body = body.trim()
  if (!SKILL_NAME_PATTERN.test(name) || name.length > MAX_SKILL_NAME_LENGTH) {
    throw new AgentSkillValidationError({
      message: "Skill name must be 1-64 lowercase letters, numbers, or hyphen-separated words",
    })
  }
  if (!description) {
    throw new AgentSkillValidationError({ message: "Skill description is required" })
  }
  if (!body) {
    throw new AgentSkillValidationError({ message: "Skill instructions are required" })
  }
  return { name, description, body, rawContent }
}

export function validateSkillResourcePath(path: string): string {
  const normalized = path.trim()
  const parts = normalized.split("/")
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new AgentSkillValidationError({ message: `Unsafe skill resource path '${path}'` })
  }
  return normalized
}

function validateTextSkillResourcePath(path: string): string {
  const normalized = validateSkillResourcePath(path)
  const filename = normalized.split("/").at(-1) ?? normalized
  const dotIndex = filename.lastIndexOf(".")
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : ""
  if (!TEXT_RESOURCE_EXTENSIONS.has(extension)) {
    throw new AgentSkillValidationError({
      message: `Skill resource '${path}' is not a supported text file`,
    })
  }
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

async function listAllObjects(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    objects.push(...page.objects)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return objects.sort((left, right) => left.key.localeCompare(right.key))
}

export async function deleteGlobalSkillPackage(bucket: R2Bucket, slug: string): Promise<void> {
  const keys = (await listAllObjects(bucket, globalSkillPrefix(slug))).map((object) => object.key)
  if (keys.length > 0) {
    await bucket.delete(keys)
  }
}

async function readGlobalSkillMarkdown(bucket: R2Bucket, slug: string): Promise<string | null> {
  const object = await bucket.get(globalSkillMarkdownKey(slug))
  return object ? object.text() : null
}

async function ensureBuiltInPackage(
  store: AgentSkillStore,
  bucket: R2Bucket,
  skill: AgentSkillRecord,
): Promise<AgentSkillRecord> {
  if (skill.id !== S0_CREATE_PR_SKILL_ID || skill.origin !== "built-in") {
    return skill
  }
  const expected = S0_CREATE_PR_SKILL_MD
  const existing = await readGlobalSkillMarkdown(bucket, skill.slug)
  const contentHash = await hashSkillContent(expected)
  if (existing !== expected) {
    await writeGlobalSkillMarkdown(bucket, skill.slug, expected)
  }
  if (skill.contentHash !== contentHash) {
    await Effect.runPromise(store.updateContentHash(skill.id, contentHash))
    return { ...skill, contentHash, updatedAt: Date.now() }
  }
  return skill
}

export async function loadRuntimeSkillPackage(
  bucket: R2Bucket,
  skill: AgentSkillRecord,
): Promise<RuntimeSkillPackage> {
  const rawContent = await readGlobalSkillMarkdown(bucket, skill.slug)
  if (!rawContent) {
    throw new AgentSkillValidationError({
      message: `Skill '${skill.name}' is missing ${globalSkillMarkdownKey(skill.slug)}`,
    })
  }
  const parsed = parseAgentSkillMarkdown(rawContent)
  if (parsed.name !== skill.name) {
    throw new AgentSkillValidationError({
      message: `Skill '${skill.name}' frontmatter name does not match its catalog entry`,
    })
  }
  const prefix = globalSkillPrefix(skill.slug)
  const files = await Promise.all(
    (await listAllObjects(bucket, prefix))
      .filter((object) => object.key !== globalSkillMarkdownKey(skill.slug))
      .map(async (object): Promise<RuntimeSkillFile> => {
        const path = validateTextSkillResourcePath(object.key.slice(prefix.length))
        const body = await bucket.get(object.key)
        if (!body) {
          throw new AgentSkillValidationError({
            message: `Skill resource '${object.key}' disappeared while loading`,
          })
        }
        return { path, content: await body.text() }
      }),
  )
  return {
    id: skill.id,
    contentHash: await hashSkillContent(
      JSON.stringify({ rawContent, files: files.map((file) => [file.path, file.content]) }),
    ),
    name: parsed.name,
    description: parsed.description,
    content: parsed.body,
    files,
  }
}

export async function createAdminGlobalSkill(input: {
  db: D1Database
  bucket: R2Bucket
  skillMd: string
  defaultEnabled: boolean
  adminUserId: string
}): Promise<AgentSkillRecord> {
  const parsed = parseAgentSkillMarkdown(input.skillMd)
  const contentHash = await hashSkillContent(input.skillMd)
  const store = new AgentSkillStore(makeD1Drizzle(input.db))
  const existing = await Effect.runPromise(store.getActiveGlobalBySlug(parsed.name))
  if (Option.isSome(existing)) {
    throw new AgentSkillConflictError({ message: `Skill '${parsed.name}' already exists` })
  }
  const previousPackage = await readGlobalSkillMarkdown(input.bucket, parsed.name)
  await writeGlobalSkillMarkdown(input.bucket, parsed.name, input.skillMd)
  try {
    return await Effect.runPromise(
      store.createGlobal({
        name: parsed.name,
        description: parsed.description,
        contentHash,
        defaultEnabled: input.defaultEnabled,
        createdByUserId: input.adminUserId,
      }),
    )
  } catch (error) {
    if (previousPackage === null) {
      await deleteGlobalSkillPackage(input.bucket, parsed.name).catch(() => undefined)
    } else {
      await writeGlobalSkillMarkdown(input.bucket, parsed.name, previousPackage).catch(
        () => undefined,
      )
    }
    throw error
  }
}

export async function resolveRuntimeSkillPackages(input: {
  db: D1Database
  bucket: R2Bucket
  userId: string
}): Promise<RuntimeSkillPackage[]> {
  const store = new AgentSkillStore(makeD1Drizzle(input.db))
  const effective = await Effect.runPromise(store.listEffectiveGlobal(input.userId, "harness"))
  return Promise.all(
    effective
      .filter((skill) => skill.enabled)
      .map(async (skill) =>
        loadRuntimeSkillPackage(
          input.bucket,
          await ensureBuiltInPackage(store, input.bucket, skill),
        ),
      ),
  )
}

export async function listEffectiveGlobalSkills(input: {
  db: D1Database
  userId: string
}): Promise<EffectiveAgentSkill[]> {
  return Effect.runPromise(
    new AgentSkillStore(makeD1Drizzle(input.db)).listEffectiveGlobal(input.userId, "harness"),
  )
}

export async function listAdminGlobalSkills(db: D1Database): Promise<AgentSkillRecord[]> {
  return Effect.runPromise(new AgentSkillStore(makeD1Drizzle(db)).listActiveGlobal("harness"))
}

export async function listIsolateGlobalSkillNames(input: {
  db: D1Database
  userId: string
}): Promise<string[]> {
  const effective = await Effect.runPromise(
    new AgentSkillStore(makeD1Drizzle(input.db)).listEffectiveGlobal(input.userId, "isolate"),
  )
  return effective.filter((skill) => skill.enabled).map((skill) => skill.name)
}
