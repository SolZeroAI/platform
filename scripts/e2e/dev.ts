import { spawn } from "node:child_process"
import { appEnvironment } from "./environment"

// Keep the declared Cloudflare bindings and Alchemy stack; never replace them with mocks.
const child = spawn("nub", ["run", "dev"], { stdio: "inherit", env: appEnvironment })
process.on("SIGINT", () => child.kill("SIGINT"))
process.on("SIGTERM", () => child.kill("SIGTERM"))
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 130 : 1)
})
