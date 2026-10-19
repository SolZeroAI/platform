import { test } from "@e2e-dev/web"
import { expect } from "e2e"

test("outer cancellation interrupts a live SDK suite", async ({ app }) => {
  await app.open("/")
  await expect.poll(() => false, { timeout: 120_000 }).toBe(true)
})
