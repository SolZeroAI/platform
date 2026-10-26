import { afterEach, describe, expect, it, mock } from "bun:test";
import { Effect, Result } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildError, readText } from "./build-skill.ts";

const roots: string[] = [];
afterEach(() => {
  mock.restore();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("alchemy build boundaries", () => {
  it("reads lazily and repeats without retaining file contents", async () => {
    const root = mkdtempSync(join(tmpdir(), "alchemy-effect-"));
    roots.push(root);
    const path = join(root, "source.md");
    const program = readText(path);
    writeFileSync(path, "first");
    expect(await Effect.runPromise(program)).toBe("first");
    writeFileSync(path, "second");
    expect(await Effect.runPromise(program)).toBe("second");
  });

  it("reports missing source files through a typed failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "alchemy-effect-"));
    roots.push(root);
    const path = join(root, "missing.md");
    const result = await Effect.runPromise(Effect.result(readText(path)));
    expect(Result.isFailure(result)).toBe(true);
    if (!Result.isFailure(result)) throw new Error("Expected missing-file failure");
    expect(result.failure instanceof BuildError).toBe(true);
    expect(result.failure.operation).toBe(`read ${path}`);
    expect((result.failure.cause as NodeJS.ErrnoException).code).toBe("ENOENT");
  });
});
