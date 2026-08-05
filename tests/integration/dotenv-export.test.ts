import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import { dotenvAssignment } from "../../packages/api/src/server/lib/dotenv"

const parseAssignment = (assignment: string) =>
  Effect.runSync(
    Config.string("S0_CONFIG_TEST").parse(ConfigProvider.fromDotEnvContents(assignment)),
  )

describe("dotenv export", () => {
  it.each([
    ["apostrophe", "admin's value"],
    ["backslash", String.raw`path\\to\\value`],
    ["double quote", 'say "hello"'],
    ["newline", "first line\nsecond line"],
    ["combined characters", 'admin\'s \\"value\\"\nnext line'],
    ["trailing backslash", "value ending in \\"],
    ["hash and trailing backslash", "value # ending in \\"],
  ])("round-trips a value containing %s", (_label, value) => {
    const assignment = Effect.runSync(dotenvAssignment("S0_CONFIG_TEST", value))

    expect(parseAssignment(assignment)).toBe(value)
  })

  it("uses an unquoted value when it is the only lossless representation", () => {
    const value = "single ' double \" backtick `"
    const assignment = Effect.runSync(dotenvAssignment("S0_CONFIG_TEST", value))

    expect(assignment).toBe(`S0_CONFIG_TEST=${value}`)
    expect(parseAssignment(assignment)).toBe(value)
  })

  it("fails instead of emitting a value that dotenv would change", () => {
    expect(() =>
      Effect.runSync(
        dotenvAssignment("S0_CONFIG_TEST", "single ' double \" backtick ` # comment\nnext line"),
      ),
    ).toThrow("Dotenv value cannot be represented without changing its contents")
  })

  it.each(["first line\rsecond line", "first line\r\nsecond line"])(
    "fails instead of allowing dotenv to normalize carriage returns in %j",
    (value) => {
      expect(() => Effect.runSync(dotenvAssignment("S0_CONFIG_TEST", value))).toThrow(
        "Dotenv values containing carriage returns cannot be exported losslessly",
      )
    },
  )

  it("rejects variable names that could create another assignment", () => {
    expect(() => Effect.runSync(dotenvAssignment("S0_CONFIG_TEST\nINJECTED", "value"))).toThrow(
      "Invalid dotenv variable name",
    )
  })
})
