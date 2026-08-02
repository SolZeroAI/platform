import { DatabaseSync } from "node:sqlite"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import {
  clearParentTurnEnvelope,
  parentTurnEnvelopeFromPrompt,
  readParentTurnEnvelope,
  registerParentTurnEnvelope,
  setParentTurnFinalizationMode,
} from "../../packages/api/src/server/background/isolate/agent/parent-turn-envelope"

type SqliteStatement = ReturnType<DatabaseSync["prepare"]>
type SqliteAllParams = Parameters<SqliteStatement["all"]>
type SqliteRunParams = Parameters<SqliteStatement["run"]>

class SqliteStorage {
  constructor(private readonly db: DatabaseSync) {}

  exec(query: string, ...params: unknown[]): { toArray(): unknown[] } {
    const returnsRows = query.trimStart().toUpperCase().startsWith("SELECT")
    const rows = returnsRows
      ? this.db.prepare(query).all(...(params as SqliteAllParams))
      : this.run(query, params)
    return { toArray: () => rows }
  }

  private run(query: string, params: unknown[]): unknown[] {
    if (params.length === 0) {
      this.db.exec(query)
    } else {
      this.db.prepare(query).run(...(params as SqliteRunParams))
    }
    return []
  }
}

describe("Isolate parent turn recovery envelope", () => {
  it("persists only trusted runtime fields and clears them at the terminal boundary", () => {
    const db = new DatabaseSync(":memory:")
    const sql = new SqliteStorage(db)
    const rawPrompt = "do not persist this prompt body"
    const callbackMarker = "do not persist this callback"
    const promptRequest = {
      messageId: "message-1",
      content: rawPrompt,
      model: "provider/model",
      reasoningEffort: "high",
      githubAccessToken: "private-installation-token",
      callback: callbackMarker,
    }
    const envelope = parentTurnEnvelopeFromPrompt(
      promptRequest,
      "Repository checkout is unavailable",
    )

    registerParentTurnEnvelope(sql, envelope)

    expect(Option.getOrNull(readParentTurnEnvelope(sql))).toEqual(envelope)
    const rawRows = db.prepare("SELECT * FROM c0_isolate_parent_turn_recovery").all() as Record<
      string,
      unknown
    >[]
    const persisted = JSON.stringify(rawRows)
    expect(persisted).not.toContain(rawPrompt)
    expect(persisted).not.toContain(callbackMarker)
    expect(persisted).toContain("private-installation-token")

    setParentTurnFinalizationMode(sql, true)
    expect(Option.getOrNull(readParentTurnEnvelope(sql))).toMatchObject({
      messageId: "message-1",
      finalizingAfterStepLimit: true,
    })

    clearParentTurnEnvelope(sql)
    expect(Option.isNone(readParentTurnEnvelope(sql))).toBe(true)
    db.close()
  })

  it("atomically replaces a stale singleton envelope with the newest turn", () => {
    const db = new DatabaseSync(":memory:")
    const sql = new SqliteStorage(db)
    const first = parentTurnEnvelopeFromPrompt(
      { messageId: "message-old", content: "old", model: "model-old" },
      null,
    )
    const latest = parentTurnEnvelopeFromPrompt(
      { messageId: "message-new", content: "new", model: "model-new" },
      null,
    )

    registerParentTurnEnvelope(sql, first)
    registerParentTurnEnvelope(sql, latest)

    expect(Option.getOrNull(readParentTurnEnvelope(sql))).toEqual(latest)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM c0_isolate_parent_turn_recovery").get(),
    ).toEqual({ count: 1 })
    db.close()
  })
})
