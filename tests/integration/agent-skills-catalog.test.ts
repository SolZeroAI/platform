import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as Effect from "effect/Effect"
import {
  AgentSkillStore,
  createAdminGlobalSkill,
  deleteGlobalSkillPackage,
  globalSkillMarkdownKey,
  listEffectiveGlobalSkills,
  listIsolateGlobalSkillNames,
  loadRuntimeSkillPackage,
  parseAgentSkillMarkdown,
  resolveRuntimeSkillPackages,
  validateSkillResourcePath,
} from "../../packages/api/src/server/background/skills/catalog"
import {
  S0_CREATE_PR_SKILL_ID,
  S0_CREATE_PR_SKILL_MD,
} from "../../packages/api/src/server/background/skills/built-ins"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const migration = ["0027_agent_skills.sql", "0030_s0_agent_skill_prefix.sql"]
  .map((filename) =>
    readFileSync(resolve(__dirname, `../../packages/infra/d1-migrations/${filename}`), "utf8"),
  )
  .join("\n")

type SqliteValue = string | number | bigint | null | Uint8Array

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
    private readonly params: SqliteValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.db, this.query, values.map(toSqliteValue))
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.params) as Record<string, T> | undefined
    if (!row) {
      return null
    }
    return columnName ? (row[columnName] ?? null) : (row as T)
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.query).run(...this.params)
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        duration: 0,
        last_row_id: Number(result.lastInsertRowid),
      },
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return {
      results: this.db.prepare(this.query).all(...this.params) as T[],
      success: true,
      meta: { duration: 0 },
    }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const statement = this.db.prepare(this.query)
    const columns = statement.columns().map((column) => column.name)
    const rows = statement.all(...this.params) as Record<string, unknown>[]
    return rows.map((row) => columns.map((column) => row[column])) as T[]
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.db, query)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return Promise.all(statements.map((statement) => statement.run<T>()))
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query)
    return { count: 0, duration: 0 }
  }
}

function toSqliteValue(value: unknown): SqliteValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === null ||
    value instanceof Uint8Array
  ) {
    return value
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0
  }
  throw new TypeError(`Unsupported SQLite bind value: ${String(value)}`)
}

class MemorySkillBucket {
  readonly objects = new Map<string, string>()
  failNextPut = false

  async put(key: string, value: string | ReadableStream | ArrayBuffer | ArrayBufferView | Blob) {
    if (this.failNextPut) {
      this.failNextPut = false
      throw new Error("R2 write failed")
    }
    if (typeof value !== "string") {
      throw new TypeError("Tests only support string R2 values")
    }
    this.objects.set(key, value)
    return { key } as R2Object
  }

  async get(key: string) {
    const value = this.objects.get(key)
    if (value === undefined) {
      return null
    }
    return {
      key,
      text: async () => value,
      arrayBuffer: async () => new TextEncoder().encode(value).buffer,
    } as R2ObjectBody
  }

  async list(options: R2ListOptions = {}) {
    const prefix = options.prefix ?? ""
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({
        key,
        etag: key,
        size: value.length,
        uploaded: new Date(0),
      })) as R2Object[]
    return { objects, truncated: false, delimitedPrefixes: [] } as R2Objects
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key)
    }
  }
}

const ADMIN_SKILL_MD = `---
name: review-code
description: Review a code change when the user asks for review.
---

# Review code

Inspect the diff and report findings.
`

describe("global agent skills", () => {
  let sqlite: DatabaseSync
  let db: D1Database
  let bucket: MemorySkillBucket

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:")
    sqlite.exec(migration)
    db = new SqliteD1Database(sqlite)
    bucket = new MemorySkillBucket()
  })

  afterEach(() => {
    sqlite.close()
  })

  it("materializes the default-enabled built-in for harnesses but never isolates", async () => {
    const packages = await resolveRuntimeSkillPackages({
      db,
      bucket: bucket as unknown as R2Bucket,
      userId: "user-1",
    })

    expect(packages).toHaveLength(1)
    expect(packages[0]).toMatchObject({
      id: S0_CREATE_PR_SKILL_ID,
      name: "s0-create-pr",
      content: expect.stringContaining('s0-create-pr "PR title" "PR body"'),
    })
    expect(bucket.objects.get(globalSkillMarkdownKey("s0-create-pr"))).toBe(S0_CREATE_PR_SKILL_MD)
    expect(await listIsolateGlobalSkillNames({ db, userId: "user-1" })).toEqual([])
  })

  it("resolves explicit preferences before the admin default and resets cleanly", async () => {
    const store = new AgentSkillStore(db)
    await Effect.runPromise(store.setPreference("user-1", S0_CREATE_PR_SKILL_ID, false))
    expect(await listEffectiveGlobalSkills({ db, userId: "user-1" })).toMatchObject([
      { id: S0_CREATE_PR_SKILL_ID, defaultEnabled: true, enabled: false, overridden: true },
    ])
    expect(
      await resolveRuntimeSkillPackages({
        db,
        bucket: bucket as unknown as R2Bucket,
        userId: "user-1",
      }),
    ).toEqual([])

    await Effect.runPromise(store.clearPreference("user-1", S0_CREATE_PR_SKILL_ID))
    expect(await listEffectiveGlobalSkills({ db, userId: "user-1" })).toMatchObject([
      { id: S0_CREATE_PR_SKILL_ID, defaultEnabled: true, enabled: true, overridden: false },
    ])
  })

  it("tombstones before R2 cleanup and never resurrects the built-in", async () => {
    await resolveRuntimeSkillPackages({
      db,
      bucket: bucket as unknown as R2Bucket,
      userId: "user-1",
    })
    const store = new AgentSkillStore(db)
    await Effect.runPromise(store.setPreference("user-1", S0_CREATE_PR_SKILL_ID, true))
    const deleted = await Effect.runPromise(store.softDelete(S0_CREATE_PR_SKILL_ID))

    expect(bucket.objects.has(globalSkillMarkdownKey("s0-create-pr"))).toBe(true)
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM user_agent_skill_preferences").get() as {
        count: number
      },
    ).toEqual({ count: 0 })
    expect(
      await resolveRuntimeSkillPackages({
        db,
        bucket: bucket as unknown as R2Bucket,
        userId: "user-1",
      }),
    ).toEqual([])

    await deleteGlobalSkillPackage(bucket as unknown as R2Bucket, deleted.slug)
    expect(bucket.objects.has(globalSkillMarkdownKey("s0-create-pr"))).toBe(false)
  })

  it("prevents duplicate active slugs without overwriting the existing R2 package", async () => {
    await createAdminGlobalSkill({
      db,
      bucket: bucket as unknown as R2Bucket,
      skillMd: ADMIN_SKILL_MD,
      defaultEnabled: false,
      adminUserId: "admin-1",
    })

    await expect(
      createAdminGlobalSkill({
        db,
        bucket: bucket as unknown as R2Bucket,
        skillMd: ADMIN_SKILL_MD.replace("Inspect the diff", "Replace the package"),
        defaultEnabled: true,
        adminUserId: "admin-1",
      }),
    ).rejects.toMatchObject({ _tag: "AgentSkillConflictError" })
    expect(bucket.objects.get(globalSkillMarkdownKey("review-code"))).toBe(ADMIN_SKILL_MD)
  })

  it("does not create an active catalog entry when the R2 write fails", async () => {
    bucket.failNextPut = true
    await expect(
      createAdminGlobalSkill({
        db,
        bucket: bucket as unknown as R2Bucket,
        skillMd: ADMIN_SKILL_MD,
        defaultEnabled: true,
        adminUserId: "admin-1",
      }),
    ).rejects.toThrow("R2 write failed")

    const row = sqlite
      .prepare("SELECT COUNT(*) AS count FROM agent_skills WHERE slug = 'review-code'")
      .get() as { count: number }
    expect(row.count).toBe(0)
  })

  it("preserves raw SKILL.md while loading the body and safe text resources", async () => {
    const skill = await createAdminGlobalSkill({
      db,
      bucket: bucket as unknown as R2Bucket,
      skillMd: ADMIN_SKILL_MD,
      defaultEnabled: true,
      adminUserId: "admin-1",
    })
    await bucket.put("global/review-code/references/checklist.md", "# Checklist")

    expect(await loadRuntimeSkillPackage(bucket as unknown as R2Bucket, skill)).toMatchObject({
      name: "review-code",
      description: "Review a code change when the user asks for review.",
      content: "# Review code\n\nInspect the diff and report findings.",
      files: [{ path: "references/checklist.md", content: "# Checklist" }],
    })
    expect(bucket.objects.get(globalSkillMarkdownKey("review-code"))).toBe(ADMIN_SKILL_MD)
  })
})

describe("SKILL.md validation", () => {
  it("requires name, description, kebab-case, valid YAML, and a body", () => {
    expect(parseAgentSkillMarkdown(ADMIN_SKILL_MD)).toMatchObject({
      name: "review-code",
      body: expect.stringContaining("Inspect the diff"),
      rawContent: ADMIN_SKILL_MD,
    })
    expect(() =>
      parseAgentSkillMarkdown("---\nname: Not Kebab\ndescription: Test\n---\nBody"),
    ).toThrow("lowercase")
    expect(() => parseAgentSkillMarkdown("---\nname: valid\n---\nBody")).toThrow(
      "name and description",
    )
    expect(() => parseAgentSkillMarkdown("---\nname: valid\ndescription: Test\n---\n")).toThrow(
      "instructions are required",
    )
    expect(() => parseAgentSkillMarkdown("---\nname: [\ndescription: Test\n---\nBody")).toThrow(
      "valid YAML",
    )
  })

  it.each(["/absolute.md", "../secret.md", "references//empty.md", "references\\file.md"])(
    "rejects unsafe resource path %s",
    (path) => expect(() => validateSkillResourcePath(path)).toThrow("Unsafe skill resource path"),
  )
})
