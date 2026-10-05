import { expect } from "e2e"
import type { Browser } from "@e2e-dev/web"

export async function api<T>(
  browser: Browser,
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const cookies = await browser.cookies()
  const response = await fetch(new URL(path, "http://localhost:3100"), {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(200)
  expect(response.status, `${method} ${path}`).toBeLessThan(300)
  // This is the live API boundary; tests pin the fields each user flow consumes.
  return (await response.json()) as T
}

export const uniqueName = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
