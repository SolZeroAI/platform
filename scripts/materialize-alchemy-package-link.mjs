import { lstat, mkdir, readdir, readlink, rename, rm, symlink } from "node:fs/promises"
import path from "node:path"

// Nub links node_modules/alchemy to the in-project store. The publish action
// records that directory link and does not walk it, then requires
// node_modules/alchemy/bin/cli.js as its own archive member. Replace the
// directory link with relative file links into the same store so the member
// exists and the bytes stay in one place.
const linkPath = path.resolve("node_modules/alchemy")
const info = await lstat(linkPath)
if (!info.isSymbolicLink()) {
  process.stdout.write("node_modules/alchemy is already a directory.\n")
  process.exit(0)
}

const targetRel = await readlink(linkPath)
const targetAbs = path.resolve(path.dirname(linkPath), targetRel)
const staging = `${linkPath}.materialized`
await rm(staging, { recursive: true, force: true })

async function walk(absDir, relDir) {
  const entries = await readdir(absDir, { withFileTypes: true })
  await mkdir(path.join(staging, relDir), { recursive: true })
  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`
    const abs = path.join(absDir, entry.name)
    const finalPath = path.join(linkPath, rel)
    const stagedPath = path.join(staging, rel)
    if (entry.isSymbolicLink()) {
      const linkTarget = path.resolve(path.dirname(abs), await readlink(abs))
      await symlink(path.relative(path.dirname(finalPath), linkTarget), stagedPath)
      continue
    }
    if (entry.isDirectory()) {
      await walk(abs, rel)
      continue
    }
    await symlink(path.relative(path.dirname(finalPath), abs), stagedPath)
  }
}

await walk(targetAbs, "")
await rm(linkPath)
await rename(staging, linkPath)
process.stdout.write("Replaced node_modules/alchemy with relative links into the Nub store.\n")
