import type { EventRow } from "./types"
import { decodeEventRows, decodeSqlChangeCount } from "./row-schemas"

export interface SessionEventCreateInput {
  readonly id: string
  readonly type: string
  readonly data: string
  readonly messageId: string | null
  readonly createdAt: number
}

interface EventSqlResult {
  one(): unknown
  toArray(): unknown[]
}

interface EventSqlStorage {
  exec(query: string, ...params: unknown[]): EventSqlResult
}

export class SessionEventRepository {
  constructor(private readonly eventSql: EventSqlStorage) {}

  createEvent(input: SessionEventCreateInput): void {
    this.eventSql.exec(
      "INSERT INTO events (id, type, data, message_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      input.id,
      input.type,
      input.data,
      input.messageId,
      input.createdAt,
    )
  }

  createEventIfAbsent(input: SessionEventCreateInput): boolean {
    this.eventSql.exec(
      "INSERT OR IGNORE INTO events (id, type, data, message_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      input.id,
      input.type,
      input.data,
      input.messageId,
      input.createdAt,
    )
    const result = this.eventSql.exec("SELECT changes() AS count").one()
    return Number(decodeSqlChangeCount(result ?? {}).count ?? 0) > 0
  }

  listEvents(limit: number): EventRow[] {
    return decodeEventRows(
      this.eventSql
        .exec("SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?1", limit)
        .toArray(),
    )
  }

  listEventsByType(type: string, limit: number): EventRow[] {
    return decodeEventRows(
      this.eventSql
        .exec(
          "SELECT * FROM events WHERE type = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2",
          type,
          limit,
        )
        .toArray(),
    )
  }

  listEventsForMessage(messageId: string): EventRow[] {
    return decodeEventRows(
      this.eventSql
        .exec(
          "SELECT * FROM events WHERE message_id = ?1 ORDER BY created_at ASC, rowid ASC",
          messageId,
        )
        .toArray(),
    )
  }

  getEventsForReplay(limit: number): EventRow[] {
    return decodeEventRows(
      this.eventSql
        .exec(
          `SELECT id, type, data, message_id, created_at FROM (
           SELECT rowid AS event_rowid, * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?1
         ) sub ORDER BY created_at ASC, event_rowid ASC`,
          limit,
        )
        .toArray(),
    )
  }

  /**
   * Hydrate complete messages for any sub-agent run visible in the replay tail.
   * This preserves the ordinary pagination window while ensuring a refresh can
   * reconstruct child task metadata, text, tools, and terminal duration even
   * when one parent response produced more than `limit` event frames.
   */
  getEventsForReplayWithSubagentHistory(limit: number): EventRow[] {
    return decodeEventRows(
      this.eventSql
        .exec(
          `WITH latest AS (
           SELECT rowid AS event_rowid, *
           FROM events
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?1
         ), subagent_messages AS (
           SELECT DISTINCT message_id
           FROM latest
           WHERE type = 'subagent_event' AND message_id IS NOT NULL
         ), hydrated AS (
           SELECT rowid AS event_rowid, *
           FROM events
           WHERE rowid IN (SELECT event_rowid FROM latest)
              OR message_id IN (SELECT message_id FROM subagent_messages)
         )
         SELECT id, type, data, message_id, created_at
         FROM hydrated
         ORDER BY created_at ASC, event_rowid ASC`,
          limit,
        )
        .toArray(),
    )
  }

  getEventsHistoryPage(
    cursorTimestamp: number,
    cursorId: string,
    limit: number,
  ): { events: EventRow[]; hasMore: boolean } {
    const rows = decodeEventRows(
      this.eventSql
        .exec(
          `SELECT * FROM events
         WHERE (created_at < ?1) OR (
           created_at = ?1 AND rowid < COALESCE((SELECT rowid FROM events WHERE id = ?2 LIMIT 1), 9223372036854775807)
         )
         ORDER BY created_at DESC, rowid DESC LIMIT ?3`,
          cursorTimestamp,
          cursorId,
          limit + 1,
        )
        .toArray(),
    )

    const hasMore = rows.length > limit
    if (hasMore) {
      rows.pop()
    }
    rows.reverse()
    return { events: rows, hasMore }
  }
}
