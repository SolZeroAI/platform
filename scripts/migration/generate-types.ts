import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const path = "scripts/migration/env.d.ts"
const result = spawnSync(
  "nub",
  [
    "exec",
    "wrangler",
    "types",
    "--config",
    "scripts/migration/wrangler.example.jsonc",
    "--env-interface",
    "MigrationWorkerEnv",
    "--include-runtime=false",
    "--strict-vars=false",
    path,
  ],
  { stdio: "inherit" },
)
if (result.status !== 0) throw new Error("Migration Worker binding generation failed")
// Module-scope the standalone Worker's generated types; do not merge its bindings into the app's Cloudflare.Env.
writeFileSync(path, readFileSync(path, "utf8") + "\nexport type { MigrationWorkerEnv }\n")
