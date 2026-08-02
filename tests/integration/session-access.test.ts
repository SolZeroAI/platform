import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import { resolveSessionAccess } from "../../packages/api/src/server/background/session/access"

const sessionRecord = {
  id: "session-1",
  user_id: "user-1",
  title: "Demo",
  repo_owner: "example-org",
  repo_name: "ai",
  github_installation_id: null,
  github_repo_id: null,
  repo_default_branch: null,
  branch_name: null,
  tools_json: "[]",
  custom_mcp_json: "{}",
  model: "test/model",
  reasoning_effort: null,
  session_kind: "isolate",
  source: "web",
  incognito: false,
  status: "created",
  created_at: 1,
  updated_at: 1,
} as const

describe("session access policy", () => {
  it("grants owner access to the session creator", async () => {
    const access = await Effect.runPromise(
      resolveSessionAccess(
        {
          getById: () => Effect.succeed(Option.some(sessionRecord)),
        },
        "session-1",
        "user-1",
      ),
    )

    expect(Option.getOrNull(access)).toEqual({
      session: expect.objectContaining({
        id: "session-1",
        user_id: "user-1",
      }),
      userId: "user-1",
      role: "owner",
    })
  })

  it("denies access to users who did not create the session", async () => {
    const access = await Effect.runPromise(
      resolveSessionAccess(
        {
          getById: () => Effect.succeed(Option.some(sessionRecord)),
        },
        "session-1",
        "user-2",
      ),
    )

    expect(Option.isNone(access)).toBe(true)
  })
})
