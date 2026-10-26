import { describe, test, expect } from "e2e"
import { join } from "node:path"
import { readFile, writeFile, stat } from "node:fs/promises"
import {
  exportStorage,
  importStorage,
  validateStorageArchive,
} from "../packages/api/src/cli/storage-transfer"
import { withStorageFixture } from "./support/storage"

describe("portable storage migration", { platforms: ["tools"] }, () => {
  for (const kind of ["r2", "kv", "session"] as const)
    test(`${kind} exports and independently verifies a distinct destination without changing the source`, async () => {
      await withStorageFixture(kind, async (fixture) => {
        const directory = join(fixture.directory, "source")

        const source = await exportStorage({
          url: fixture.sourceUrl,
          token: fixture.token,
          kind,
          directory,
          frozen: true,
          objectNames: ["original-session"],
        })

        expect(source.status).toBe("exported")
        expect((await stat(join(directory, "manifest.ndjson"))).mode & 0o777).toBe(0o600)

        const planned = await importStorage({
          directory,
          url: fixture.destinationUrl,
          token: fixture.token,
          apply: false,
          frozen: false,
        })

        expect(planned.status).toBe("planned")

        const verified = await importStorage({
          directory,
          url: fixture.destinationUrl,
          token: fixture.token,
          apply: true,
          frozen: true,
          verificationDirectory: join(fixture.directory, "verification"),
        })

        expect(verified.status).toBe("verified")
        expect(verified.bodyHash).toBe(source.bodyHash)

        const repeated = await importStorage({
          directory,
          url: fixture.destinationUrl,
          token: fixture.token,
          apply: true,
          frozen: true,
          verificationDirectory: join(fixture.directory, "repeat-verification"),
        })

        expect(repeated.bodyHash).toBe(source.bodyHash)

        const sourceAgain = await exportStorage({
          url: fixture.sourceUrl,
          token: fixture.token,
          kind,
          directory: join(fixture.directory, "source-again"),
          frozen: true,
          objectNames: ["original-session"],
        })

        expect(sourceAgain.bodyHash).toBe(source.bodyHash)
        const denied = await fetch(new URL("/info", fixture.sourceUrl))
        expect(denied.status).toBe(403)

        const sourceWrite = await fetch(new URL("/value?key=forbidden", fixture.sourceUrl), {
          method: "PUT",
          headers: { Authorization: `Bearer ${fixture.token}` },
          body: "must-not-write",
        })

        expect(sourceWrite.status).toBe(404)
        expect(JSON.stringify(verified).includes(fixture.token)).toBe(false)
      })
    })

  test("a changed blob fails archive validation before import", async () => {
    await withStorageFixture("r2", async (fixture) => {
      const directory = join(fixture.directory, "archive")
      await exportStorage({
        url: fixture.sourceUrl,
        token: fixture.token,
        kind: "r2",
        directory,
        frozen: true,
      })

      const lines = (await readFile(join(directory, "manifest.ndjson"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))

      const entry = lines.find((line) => line.type === "value")
      await writeFile(join(directory, "blobs", entry.hash), "tampered")
      let rejected = false

      try {
        await validateStorageArchive(directory)
      } catch {
        rejected = true
      }

      expect(rejected).toBe(true)
    })
  })

  test("a source resource can never be selected as its own destination", async () => {
    await withStorageFixture("kv", async (fixture) => {
      const directory = join(fixture.directory, "archive")
      await exportStorage({
        url: fixture.sourceUrl,
        token: fixture.token,
        kind: "kv",
        directory,
        frozen: true,
      })
      let rejected = false

      try {
        await importStorage({
          directory,
          url: fixture.sourceUrl,
          token: fixture.token,
          apply: true,
          frozen: true,
          verificationDirectory: join(fixture.directory, "forbidden"),
        })
      } catch {
        rejected = true
      }

      expect(rejected).toBe(true)
    })
  })
})
