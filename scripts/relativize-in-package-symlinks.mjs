import { lstat, readdir, readlink, symlink, unlink } from "node:fs/promises"
import path from "node:path"

// Nub writes a few .bin links with absolute targets. The publish action
// rejects an absolute symlink even when the target stays inside the package.
// Rewrite those links to relative targets. Do not follow a directory link.
const root = process.cwd()
let rewritten = 0

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await readlink(abs)
      if (!path.isAbsolute(target)) continue
      const resolved = path.resolve(target)
      const fromRoot = path.relative(root, resolved)
      if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
        throw new Error(`symlink escapes the package: ${path.relative(root, abs)} -> ${target}`)
      }
      await unlink(abs)
      await symlink(path.relative(path.dirname(abs), resolved), abs)
      rewritten += 1
      continue
    }
    if (entry.isDirectory()) await walk(abs)
  }
}

const rootInfo = await lstat(root)
if (!rootInfo.isDirectory()) {
  throw new Error(`package root is not a directory: ${root}`)
}
await walk(root)
process.stdout.write(`Rewrote ${rewritten} absolute in-package symlink(s).\n`)
