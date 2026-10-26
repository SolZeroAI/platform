/* oxlint-disable effect/avoid-process-env -- Operator-only CLI reads its explicit transfer token bindings. */
import { parseArgs } from "node:util"
import { readFile, stat } from "node:fs/promises"
import * as Schema from "effect/Schema"
import {
  exportStorage,
  importStorage,
  StorageTransferError,
} from "../../packages/api/src/cli/storage-transfer"

try {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(process.argv[2] === "--" ? 3 : 2),
    allowPositionals: true,
    options: {
      url: { type: "string" },
      directory: { type: "string" },
      kind: { type: "string" },
      "object-names": { type: "string" },
      "verification-directory": { type: "string" },
      "writes-frozen": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
    },
  })

  const command = positionals[0]

  if (
    positionals.length !== 1 ||
    !["export", "import", "verify"].includes(command ?? "") ||
    !values.url ||
    !values.directory
  )
    throw new StorageTransferError(
      "Usage: migration:storage export|import|verify --url <operator-root-url> --directory <private-bundle> [--kind r2|kv|session|isolate] [--object-names <JSON-file>] [--apply --writes-frozen --verification-directory <new-path>]",
    )
  let result

  if (command === "export") {
    const kind = Schema.decodeUnknownSync(Schema.Literals(["r2", "kv", "session", "isolate"]))(
      values.kind,
    )

    let objectNames: readonly string[] | undefined

    if (values["object-names"]) {
      if ((await stat(values["object-names"])).size > 8 * 1024 * 1024)
        throw new StorageTransferError("The explicit object-name inventory is too large.")
      objectNames = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
        JSON.parse(await readFile(values["object-names"], "utf8")),
      )
    }

    result = await exportStorage({
      url: values.url,
      token: process.env.MIGRATION_SOURCE_TOKEN ?? "",
      directory: values.directory,
      kind,
      frozen: values["writes-frozen"],
      objectNames,
    })
  } else {
    if (command === "verify") {
      // Verification is a new, independent destination export, not a replay of the write report.
      const { validateStorageArchive } = await import("../../packages/api/src/cli/storage-transfer")
      const source = await validateStorageArchive(values.directory)
      const directory = values["verification-directory"]

      if (!directory || !values["writes-frozen"])
        throw new StorageTransferError(
          "Verification requires a new --verification-directory and --writes-frozen.",
        )
      await importStorage({
        directory: values.directory,
        url: values.url,
        token: process.env.MIGRATION_DESTINATION_TOKEN ?? "",
        apply: false,
        frozen: false,
      })
      const names: string[] = []

      if (["session", "isolate"].includes(source.header.source.kind)) {
        if (!values["object-names"])
          throw new StorageTransferError(
            "Provide the same explicit --object-names inventory for verification.",
          )

        if ((await stat(values["object-names"])).size > 8 * 1024 * 1024)
          throw new StorageTransferError("The explicit object-name inventory is too large.")
        names.push(
          ...Schema.decodeUnknownSync(Schema.Array(Schema.String))(
            JSON.parse(await readFile(values["object-names"], "utf8")),
          ),
        )
      }

      const proof = await exportStorage({
        url: values.url,
        token: process.env.MIGRATION_DESTINATION_TOKEN ?? "",
        directory,
        kind: source.header.source.kind,
        frozen: true,
        objectNames: names,
        allowWritableVerification: true,
      })

      if (proof.bodyHash !== source.bodyHash || proof.entries !== source.entries)
        throw new StorageTransferError("Independent destination export differs; do not cut over.")
      result = { ...proof, status: "verified" }
    } else
      result = await importStorage({
        directory: values.directory,
        url: values.url,
        token: process.env.MIGRATION_DESTINATION_TOKEN ?? "",
        apply: values.apply,
        frozen: values["writes-frozen"],
        verificationDirectory: values["verification-directory"],
      })
  }

  process.stdout.write(JSON.stringify(result) + "\n")
} catch (error) {
  process.stderr.write(
    (error instanceof StorageTransferError
      ? error.message
      : "Storage migration failed. Raw SDK, file and payload details are suppressed to protect data.") +
      "\n",
  )
  process.exitCode = 1
}
