import { DurableObject } from "cloudflare:workers"
import operator from "../../scripts/migration/worker"
import { durableMigration } from "../../packages/api/src/migration/durable-state"
type FixtureEnv = Parameters<typeof operator.fetch>[1]

export class MigrationFixture extends DurableObject<FixtureEnv> {
  alarm() {
    throw new Error("Fixture alarms must not execute during transfer")
  }
  constructor(ctx: DurableObjectState, env: FixtureEnv) {
    super(ctx, env)
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, author TEXT REFERENCES participants(id), body TEXT, attachment BLOB)",
    )
  }
  async fetch(): Promise<Response> {
    this.ctx.storage.sql.exec("INSERT INTO participants VALUES ('owner', 'Original Owner')")
    this.ctx.storage.sql.exec(
      "INSERT INTO messages VALUES ('message-original', 'owner', 'original conversation', ?)",
      new Uint8Array([0, 1, 255]).buffer,
    )
    this.ctx.storage.kv.put("state", {
      sessionId: "original-session",
      bytes: new Uint8Array([0, 255]),
      tags: new Set(["retained"]),
      created: new Date("2026-01-01T00:00:00Z"),
    })
    for (let index = 0; index < 105; index++)
      this.ctx.storage.kv.put(`entry-${String(index).padStart(3, "0")}`, index)
    await this.ctx.storage.setAlarm(Date.now() + 3600000)
    return new Response(null, { status: 201 })
  }
  migrationState(request: unknown) {
    return durableMigration(this.ctx, request, {
      empty:
        this.ctx.storage.sql
          .exec<{ count: number }>("SELECT count(*) AS count FROM participants")
          .one().count === 0,
      quiescent: true,
    })
  }
}
export default {
  async fetch(request: Request, env: FixtureEnv): Promise<Response> {
    if (
      new URL(request.url).pathname === "/seed" &&
      request.headers.get("Authorization") === `Bearer ${env.MIGRATION_TOKEN}`
    )
      return env.OBJECTS.get(env.OBJECTS.idFromName("original-session")).fetch(request)
    return operator.fetch(request, env)
  },
}
