import { DatabaseSync } from "node:sqlite"
import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { SessionRepository } from "../../packages/api/src/server/background/session/repository"
import { initSchema } from "../../packages/api/src/server/background/session/schema"

type SqliteStatement = ReturnType<DatabaseSync["prepare"]>
type SqliteAllParams = Parameters<SqliteStatement["all"]>
type SqliteRunParams = Parameters<SqliteStatement["run"]>

class SqliteSqlStorage {
  constructor(private readonly db: DatabaseSync) {}

  exec(query: string, ...params: unknown[]): { toArray(): unknown[]; one(): unknown } {
    const trimmed = query.trim()
    const statementKind = trimmed.split(/\s+/, 1)[0]?.toUpperCase()
    const returnsRows =
      statementKind === "SELECT" || statementKind === "WITH" || statementKind === "PRAGMA"

    if (returnsRows) {
      const rows = this.db.prepare(query).all(...(params as SqliteAllParams))
      return {
        toArray: () => rows,
        one: () => rows[0] ?? null,
      }
    }

    if (params.length === 0) {
      this.db.exec(query)
    } else {
      this.db.prepare(query).run(...(params as SqliteRunParams))
    }
    return {
      toArray: () => [],
      one: () => null,
    }
  }
}

describe("session websocket auth tokens", () => {
  it("keeps concurrent websocket tokens valid until they expire", () => {
    const db = new DatabaseSync(":memory:")

    try {
      const storage = new SqliteSqlStorage(db)
      initSchema(storage)
      const repository = new SessionRepository(storage)

      repository.createParticipant({
        id: "participant-1",
        userId: "user-1",
        role: "owner",
        joinedAt: 1,
      })
      repository.createParticipantWsToken({
        id: "token-row-1",
        participantId: "participant-1",
        tokenHash: "token-hash-1",
        createdAt: 1_000,
        expiresAt: 2_000,
      })
      repository.createParticipantWsToken({
        id: "token-row-2",
        participantId: "participant-1",
        tokenHash: "token-hash-2",
        createdAt: 1_100,
        expiresAt: 2_100,
      })

      expect(
        Option.getOrNull(repository.getParticipantByWsTokenHash("token-hash-1", 1_500, 1_000))?.id,
      ).toBe("participant-1")
      expect(
        Option.getOrNull(repository.getParticipantByWsTokenHash("token-hash-2", 1_500, 1_000))?.id,
      ).toBe("participant-1")
      expect(
        Option.getOrNull(repository.getParticipantByWsTokenHash("token-hash-1", 2_001, 1_000)),
      ).toBeNull()

      expect(repository.getWsTokenDiagnostics(1_500)).toEqual({
        participantCount: 1,
        activeTokenCount: 2,
        storedTokenCount: 2,
        latestTokenCreatedAt: 1_100,
        latestTokenAgeMs: 400,
      })
    } finally {
      db.close()
    }
  })
})
