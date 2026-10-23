import { fork } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import * as Schema from "effect/Schema"
import { stopFixture } from "./fixture-process"

const readySchema = Schema.Struct({
  token: Schema.String,
  sourceUrl: Schema.String,
  destinationUrl: Schema.String,
})
export async function withStorageFixture<T>(
  kind: "r2" | "kv" | "session",
  run: (fixture: typeof readySchema.Type & { directory: string }) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "solzero-storage-"))
  const child = fork(resolve("tests/support/storage-fixture.ts"), [kind], {
    execArgv: ["--import", import.meta.resolve("tsx")],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
  const closed = once(child, "exit")
  try {
    const ready = await new Promise<typeof readySchema.Type>((accept, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Storage fixture startup timed out")),
        30_000,
      )
      child.once("message", (value) => {
        clearTimeout(timeout)
        if (
          typeof value === "object" &&
          value !== null &&
          "error" in value &&
          typeof value.error === "string"
        )
          return reject(new Error(value.error))
        try {
          accept(Schema.decodeUnknownSync(readySchema)(value))
        } catch {
          reject(new Error("Invalid storage fixture readiness message"))
        }
      })
      child.once("exit", () => {
        clearTimeout(timeout)
        reject(new Error("Storage fixture exited before readiness"))
      })
      child.once("error", (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
    return await run({ ...ready, directory })
  } finally {
    await stopFixture(child, closed)
    await rm(directory, { recursive: true, force: true })
  }
}
