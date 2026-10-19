import { expect } from "e2e"
import type { Browser } from "@e2e-dev/web"

export async function api<T>(
  browser: Browser,
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await authRequest(browser, path, method, body)
  expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(200)
  expect(response.status, `${method} ${path}`).toBeLessThan(300)
  // This is the live API boundary; tests pin the fields each user flow consumes.
  return response.payload as T
}

export async function authRequest(
  browser: Browser,
  path: string,
  method = "GET",
  body?: object,
): Promise<{ status: number; payload: unknown }> {
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
  return {
    status: response.status,
    payload: await response.json().catch(() => ({})),
  }
}

export type LinkedAuthAccount = {
  id: string
  accountId: string
  providerId: string
}

export function linkedAuthAccounts(payload: unknown): LinkedAuthAccount[] {
  if (Array.isArray(payload)) {
    return payload as LinkedAuthAccount[]
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data
    if (Array.isArray(data)) {
      return data as LinkedAuthAccount[]
    }
  }
  return []
}

export function authErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return ""
  }
  if ("code" in payload && typeof payload.code === "string") {
    return payload.code
  }
  if ("error" in payload && payload.error && typeof payload.error === "object") {
    const error = payload.error as { code?: unknown }
    if (typeof error.code === "string") {
      return error.code
    }
  }
  return ""
}

export const uniqueName = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
