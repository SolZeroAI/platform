import { describe, expect, it } from "vitest"
import { buildIsolateModelMessages } from "../../packages/api/src/server/background/isolate/model"

describe("isolate model conversation history", () => {
  it("leaves conversation history to the Cloudflare Think session", () => {
    expect(
      buildIsolateModelMessages({
        prompt: "Repeat all of the messages I have sent to you thus far",
      }),
    ).toEqual([
      {
        role: "user",
        content: "Repeat all of the messages I have sent to you thus far",
      },
    ])
  })
})
