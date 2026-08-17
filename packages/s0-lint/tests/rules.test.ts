import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { s0RuleNames, type S0RuleName } from "../src/index"

const packageRoot = process.cwd()
const repoRoot = resolve(packageRoot, "../..")
const pluginPath = resolve(packageRoot, "src/index.ts")
const tempDirs: string[] = []

type RunResult = {
  output: string
  status: "passed" | "failed"
}

type RuleCase = {
  invalid: string
  invalidPath?: string
  valid: string
  validPath?: string
}

const effectImport = `import { Effect, Either, Fiber, Layer, Match, Option, Reactivity, Ref, Runtime, Schema, Schema as S, Stream, SubscriptionRef } from "effect";`
const maxFileLinesInvalid = Array.from(
  { length: 1001 },
  (_, index) => `export const value${index} = ${index};`,
).join("\n")
const maxFileLinesValid = Array.from(
  { length: 1000 },
  (_, index) => `export const value${index} = ${index};`,
).join("\n")

const requestSurfacePath = "packages/api/src/server/fixture.ts"

const cases: Record<S0RuleName, RuleCase> = {
  "no-colocated-tests": {
    invalid: "export const value = 1;",
    invalidPath: "apps/web/src/lib/fixture.test.ts",
    valid: "export const value = 1;",
    validPath: "apps/web/tests/lib/fixture.test.ts",
  },
  "max-file-lines": {
    invalid: maxFileLinesInvalid,
    valid: maxFileLinesValid,
  },
  "no-if-statement": {
    invalid: `${effectImport}
export const value = Effect.sync(() => {
  if (Math.random() > 0.5) {
    return 1;
  }
  return 0;
});`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-ternary": {
    invalid: `${effectImport}
export const value = Effect.succeed(Math.random() > 0.5 ? 1 : 0);`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-pipe-ladder": {
    invalid: `${effectImport}
export const value = pipe(pipe(Effect.succeed(1), Effect.map((n) => n + 1)), Effect.map((n) => n + 1));`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map((n) => n + 1));`,
  },
  "no-flatmap-ladder": {
    invalid: `${effectImport}
export const value = Effect.flatMap(Effect.flatMap(Effect.succeed(1), (n) => Effect.succeed(n)), (n) => Effect.succeed(n));`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.flatMap((n) => Effect.succeed(n)));`,
  },
  "no-effect-ladder": {
    invalid: `${effectImport}
export const value = Effect.map(Effect.flatMap(Effect.succeed(1), (n) => Effect.succeed(n)), (n) => n);`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map((n) => n));`,
  },
  "no-effect-call-in-effect-arg": {
    invalid: `${effectImport}
export const value = Effect.map(Effect.succeed(1), (n) => n);`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map((n) => n));`,
  },
  "no-nested-effect-call": {
    invalid: `${effectImport}
export const value = Effect.map(Effect.flatMap(Effect.succeed(1), (n) => Effect.succeed(n)), (n) => n);`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map((n) => n));`,
  },
  "no-effect-as": {
    invalid: `${effectImport}
export const value = Effect.as(Effect.succeed(1), 2);`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map(() => 2));`,
  },
  "no-call-tower": {
    invalid: `${effectImport}
export const value = Effect.map(Effect.succeed(1), (n) => n);`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.map((n) => n));`,
  },
  "no-option-as": {
    invalid: `${effectImport}
export const value = Option.as(Option.some(1), 2);`,
    valid: `${effectImport}
export const value = Option.map(Option.some(1), () => 2);`,
  },
  "no-arrow-ladder": {
    invalid: `${effectImport}
export const value = ((n) => ((m) => m + 1)(n))(1);`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-branch-in-object": {
    invalid: `${effectImport}
export const value = {
  status: Option.match(Option.some(1), { onNone: () => "none", onSome: () => "some" }),
};`,
    valid: `${effectImport}
const status = "some";
export const value = { status };`,
  },
  "no-iife-wrapper": {
    invalid: `${effectImport}
export const value = ((n) => n + 1)(1);`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-return-in-arrow": {
    invalid: `${effectImport}
export const value = Option.map(Option.some(1), (n) => {
  return n + 1;
});`,
    valid: `${effectImport}
export const value = Option.map(Option.some(1), (n) => n + 1);`,
  },
  "no-effect-never": {
    invalid: `${effectImport}
export const value = Effect.never;`,
    valid: `${effectImport}
export const value = Effect.void;`,
  },
  "no-effect-async": {
    invalid: `${effectImport}
export const value = Effect.async<number>(() => undefined);`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-effect-do": {
    invalid: `${effectImport}
export const value = Effect.Do;`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-effect-bind": {
    invalid: `${effectImport}
export const value = Effect.bind("value", () => Effect.succeed(1));`,
    valid: `${effectImport}
export const value = Effect.succeed(1);`,
  },
  "no-nested-effect-gen": {
    invalid: `${effectImport}
export const value = Effect.gen(function* () {
  return yield* Effect.gen(function* () {
    return 1;
  });
});`,
    valid: `${effectImport}
export const value = Effect.gen(function* () {
  return 1;
});`,
  },
  "no-match-void-branch": {
    invalid: `${effectImport}
export const value = Match.value(true).pipe(Match.when(true, () => Effect.void));`,
    valid: `${effectImport}
export const value = Match.value(true).pipe(Match.when(true, () => "ok"));`,
  },
  "no-match-effect-branch": {
    invalid: `${effectImport}
export const value = Match.value("a").pipe(
  Match.when("a", () => Effect.succeed(1).pipe(Effect.map((n) => n + 1))),
);`,
    valid: `${effectImport}
export const value = Match.value("a").pipe(Match.when("a", () => 1));`,
  },
  "warn-effect-sync-wrapper": {
    invalid: `${effectImport}
declare function touch(): number;
export const value = Effect.sync(() => touch());`,
    valid: `${effectImport}
export const value = Effect.sync(() => 1);`,
  },
  "no-effect-side-effect-wrapper": {
    invalid: `${effectImport}
export const value = Effect.as(Effect.logInfo("x"), 1);`,
    valid: `${effectImport}
export const value = Effect.logInfo("x").pipe(Effect.andThen(Effect.succeed(1)));`,
  },
  "no-effect-orElse-ladder": {
    invalid: `${effectImport}
export const value = Effect.orElse(Effect.succeed(1).pipe(Effect.tap(() => Effect.logInfo("x"))), () => Effect.succeed(2));`,
    valid: `${effectImport}
export const value = Effect.succeed(1).pipe(Effect.orElse(() => Effect.succeed(2)));`,
  },
  "no-return-in-callback": {
    invalid: `${effectImport}
export const value = Option.map(Option.some(1), (n) => {
  return n + 1;
});`,
    valid: `${effectImport}
export const value = Option.map(Option.some(1), (n) => n + 1);`,
  },
  "no-manual-effect-channels": {
    invalid: `${effectImport}
export function load(): Effect.Effect<number, never, never> {
  return Effect.succeed(1);
}`,
    valid: `${effectImport}
export const load = Effect.succeed(1);`,
  },
  "prevent-dynamic-imports": {
    invalid: `export const value = import("node:path");`,
    valid: `export const browserAutomationModules = {
  getStagehandModule: () => import("./stagehand-module"),
};`,
    validPath: "packages/api/src/server/background/workflows/runner.ts",
  },
  "prefer-option-over-null": {
    invalid: `${effectImport}
export function load(): string | undefined {
  return undefined;
}`,
    valid: `import { Effect, Option } from "effect";

type BoundaryShape = {
  readonly value: string | undefined;
};

export function load(): Option.Option<string> {
  return Option.none();
}`,
  },
  "avoid-untagged-errors": {
    invalid: `${effectImport}
export const value = Effect.tryPromise({
  try: () => Promise.resolve(1),
  catch: () => new Error("request failed"),
});`,
    valid: `import { Data, Effect } from "effect";

class RequestFailed extends Data.TaggedError("RequestFailed")<{
  readonly message: string;
}> {}

export const value = Effect.tryPromise({
  try: () => Promise.resolve(1),
  catch: () => new RequestFailed({ message: "request failed" }),
});

export function assertRuntimeInvariant() {
  throw new Error("ordinary JavaScript boundary");
}`,
  },
  "use-effect-otel": {
    invalid: `export function recordFailure(error: unknown) {
  console.error("request failed", error);
}`,
    invalidPath: requestSurfacePath,
    valid: `import { Effect } from "effect";

export const recordFailure = (error: unknown) =>
  Effect.logError(error).pipe(Effect.annotateLogs({ event: "api.request.failed" }));`,
    validPath: requestSurfacePath,
  },
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

function runOxlint(
  ruleName: S0RuleName,
  source: string,
  relativeSourcePath = "fixture.ts",
): RunResult {
  const tempDir = mkdtempSync(join(tmpdir(), "s0-lint-rules-"))
  tempDirs.push(tempDir)

  const sourcePath = join(tempDir, relativeSourcePath)
  const configPath = join(tempDir, ".oxlintrc.json")
  const relativePluginPath = relative(tempDir, pluginPath)
  const pluginSpecifier = relativePluginPath.startsWith(".")
    ? relativePluginPath
    : `./${relativePluginPath}`

  mkdirSync(dirname(sourcePath), { recursive: true })
  writeFileSync(sourcePath, source)
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        plugins: [],
        jsPlugins: [{ name: "s0-lint", specifier: pluginSpecifier }],
        rules: {
          [`s0-lint/${ruleName}`]: "error",
        },
      },
      null,
      2,
    ),
  )

  try {
    const output = execFileSync(
      "nub",
      ["exec", "oxlint", "--config", configPath, sourcePath, "--format", "unix"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    return { output, status: "passed" }
  } catch (error) {
    const failed = error as { stderr?: Buffer | string; stdout?: Buffer | string }
    return {
      output: `${failed.stdout?.toString() ?? ""}${failed.stderr?.toString() ?? ""}`,
      status: "failed",
    }
  }
}

describe("S0 oxlint rules", () => {
  for (const ruleName of s0RuleNames) {
    it(`${ruleName} reports invalid code`, () => {
      const result = runOxlint(ruleName, cases[ruleName].invalid, cases[ruleName].invalidPath)

      expect(result.status).toBe("failed")
      expect(result.output).toContain(`s0-lint(${ruleName})`)
    })

    it(`${ruleName} accepts valid code`, () => {
      const result = runOxlint(ruleName, cases[ruleName].valid, cases[ruleName].validPath)

      expect(result.status).toBe("passed")
      expect(result.output).not.toContain(`s0-lint(${ruleName})`)
    })
  }

  it("use-effect-otel accepts Effect.log calls in request observability surfaces", () => {
    const result = runOxlint(
      "use-effect-otel",
      `import { Effect } from "effect";

export const record = Effect.logInfo("request finished");`,
      requestSurfacePath,
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(use-effect-otel)")
  })

  it("use-effect-otel ignores console outside request observability surfaces", () => {
    const result = runOxlint(
      "use-effect-otel",
      `export function debug() {
  console.info("client-only debug");
}`,
      "apps/web/src/components/fixture.tsx",
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(use-effect-otel)")
  })

  it("max-file-lines ignores generated Alchemy output", () => {
    const result = runOxlint(
      "max-file-lines",
      maxFileLinesInvalid,
      "packages/infra/.alchemy/out/s0-api-dev/index.js",
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(max-file-lines)")
  })

  it("avoid-untagged-errors reports recoverable Effect.fail errors", () => {
    const result = runOxlint(
      "avoid-untagged-errors",
      `import { Effect } from "effect";

export const value = Effect.fail(new Error("recoverable"));`,
    )

    expect(result.status).toBe("failed")
    expect(result.output).toContain("s0-lint(avoid-untagged-errors)")
  })

  it("avoid-untagged-errors reports Effect.mapError errors", () => {
    const result = runOxlint(
      "avoid-untagged-errors",
      `import { Effect } from "effect";

export const value = Effect.succeed(1).pipe(
  Effect.mapError(() => new Error("recoverable")),
);`,
    )

    expect(result.status).toBe("failed")
    expect(result.output).toContain("s0-lint(avoid-untagged-errors)")
  })

  it("avoid-untagged-errors reports thrown errors inside Effect handlers", () => {
    const result = runOxlint(
      "avoid-untagged-errors",
      `import { Effect } from "effect";

export const value = Effect.gen(function* () {
  throw new Error("recoverable");
});`,
    )

    expect(result.status).toBe("failed")
    expect(result.output).toContain("s0-lint(avoid-untagged-errors)")
  })

  it("avoid-untagged-errors allows defects and ordinary JavaScript errors", () => {
    const result = runOxlint(
      "avoid-untagged-errors",
      `import { Effect } from "effect";

export const value = Effect.die(new Error("defect"));

export function assertRuntimeInvariant() {
  throw new Error("ordinary JavaScript boundary");
}`,
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(avoid-untagged-errors)")
  })

  it("composition rules ignore utility-only Effect Clock and DateTime imports", () => {
    const result = runOxlint(
      "no-if-statement",
      `import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";

export function currentIso(clock: Clock.Clock) {
  if (clock.currentTimeMillisUnsafe() > 0) {
    return DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
  }
  return DateTime.formatIso(DateTime.makeUnsafe(0));
}`,
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(no-if-statement)")
  })

  it("composition rules still run when DateTime imports accompany Effect code", () => {
    const result = runOxlint(
      "no-if-statement",
      `import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export const value = Effect.sync(() => {
  if (DateTime.toEpochMillis(DateTime.makeUnsafe(0)) === 0) {
    return 1;
  }
  return 0;
});`,
    )

    expect(result.status).toBe("failed")
    expect(result.output).toContain("s0-lint(no-if-statement)")
  })

  it("composition rules ignore allowlisted backend Effect boundaries", () => {
    const result = runOxlint(
      "no-if-statement",
      `import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export async function runBrowserAdapter() {
  if (DateTime.toEpochMillis(DateTime.makeUnsafe(0)) === 0) {
    return Effect.runPromise(Effect.succeed(1));
  }
  return 0;
}`,
      "packages/infra/alchemy.run.ts",
    )

    expect(result.status).toBe("passed")
    expect(result.output).not.toContain("s0-lint(no-if-statement)")
  })
})
