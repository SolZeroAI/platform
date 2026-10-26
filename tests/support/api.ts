import { expect } from "e2e"
import type { Browser } from "@e2e-dev/web"

export async function api<T, Body extends object = object>(
  browser: Browser,
  path: string,
  method = "GET",
  body?: Body,
): Promise<T> {
  const response = await authRequest(browser, path, method, body)
  expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(200)
  expect(response.status, `${method} ${path}`).toBeLessThan(300)

  // SAFETY: this is the live API boundary; tests pin the fields each user flow consumes.
  return response.payload as T
}

export async function authRequest<Body extends object = object>(
  browser: Browser,
  path: string,
  method = "GET",
  body?: Body,
): Promise<{ status: number; payload: unknown }> {
  const cookies = await browser.cookies()

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    },
  }

  if (body) init.body = JSON.stringify(body)

  const response = await fetch(new URL(path, "http://localhost:3100"), init)

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
    // SAFETY: list-accounts returns the linked account rows this helper reads.
    return payload as LinkedAuthAccount[]
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    // SAFETY: the data field is the linked-account list when the payload is wrapped.
    const data = (payload as { data?: unknown }).data

    if (Array.isArray(data)) {
      // SAFETY: wrapped list-accounts data is the same linked account row array.
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
    // SAFETY: the error field is an object, and code is the only field this helper reads.
    const error = payload.error as { code?: unknown }

    if (typeof error.code === "string") {
      return error.code
    }
  }

  return ""
}

export const uniqueName = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
