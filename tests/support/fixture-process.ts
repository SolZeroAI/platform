import type { ChildProcess } from "node:child_process"

/** Bound teardown to this owned child; never leave a stalled emulator running. */
export async function stopFixture(child: ChildProcess, closed: Promise<unknown>): Promise<void> {
  if (child.connected) child.send("stop")
  const terminate = setTimeout(() => child.kill("SIGTERM"), 5_000)
  const kill = setTimeout(() => child.kill("SIGKILL"), 10_000)

  try {
    await closed
  } finally {
    clearTimeout(terminate)
    clearTimeout(kill)
  }

  if (child.signalCode)
    throw new Error("Local fixture required forced teardown; no cloud resources were allocated")
}
