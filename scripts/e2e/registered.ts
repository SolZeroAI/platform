import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

const originalDirectory = process.cwd()
// Load the existing environment/profile from the repository before returning to owned Alchemy storage.
process.chdir(resolve(import.meta.dirname, "../.."))
const { registerLaunch, recordLaunch } = await import("./lifecycle")

const [id, entrypoint, ...args] = process.argv.slice(2)
try {
  registerLaunch(id)
} catch {
  console.error("Process ownership publication failed; no CLI was loaded and receipt retained.")
  process.exit(1)
}
process.chdir(originalDirectory)
process.argv = [process.execPath, entrypoint, ...args]
// The actual CLI retains its own signal/exit lifecycle. The journal does not keep it alive.
const recorder = setInterval(() => recordLaunch(id), 500)
recorder.unref()
process.on("exit", () => clearInterval(recorder))
await import(pathToFileURL(entrypoint).href)
