/**
 * The alchemy and effect-ts skills must document the same Effect release:
 * alchemy's corpus is generated from an upstream that pins one exact Effect
 * version, and effect-ts is the skill a model reaches for when writing the
 * Effect code that alchemy runs. This fails when either side is bumped alone.
 *
 * The alchemy side is `references/manifest.json`, written by
 * `build-skill.ts` from upstream `pnpm-workspace.yaml` `overrides.effect`.
 * Everything else must match it: every Effect v4 version string in the
 * effect-ts skill, and the `.claude/references/effect-v4` submodule tag that
 * skill is audited against.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";

const ALCHEMY = new URL("..", import.meta.url).pathname;
const REPO = join(ALCHEMY, "..", "..");
const EFFECT_SKILL = join(REPO, "skills", "effect-ts");

const manifest = JSON.parse(
  await readFile(join(ALCHEMY, "references", "manifest.json"), "utf8"),
) as { source: { effectVersion: string } };
const pin = manifest.source.effectVersion;

/** Prerelease v4 versions as the effect-ts skill writes them (`4.0.0-rc.117`). */
const V4_VERSION = /\b4\.\d+\.\d+-(?:alpha|beta|rc)\.\d+\b/g;

/**
 * Hidden paths are local-only (the gitignored `.source/` upstream checkout)
 * and carry every historical Effect version, so they are not part of the skill.
 */
const isHidden = (rel: string) => rel.split(sep).some((segment) => segment.startsWith("."));

async function effectSkillVersions(): Promise<Array<string>> {
  const files = (await readdir(EFFECT_SKILL, { recursive: true }))
    .filter((p) => p.endsWith(".md") && !isHidden(p))
    .toSorted();
  const found = new Set<string>();
  for (const rel of files) {
    const text = await readFile(join(EFFECT_SKILL, rel), "utf8");
    for (const m of text.matchAll(V4_VERSION)) found.add(m[0]);
  }
  return [...found];
}

describe("Effect version shared by the alchemy and effect-ts skills", () => {
  test("alchemy's corpus records an exact Effect version", () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  test("the effect-ts skill documents exactly that version", async () => {
    expect(await effectSkillVersions()).toEqual([pin]);
  });

  test("the effect-ts frontmatter names that version", async () => {
    const skill = await readFile(join(EFFECT_SKILL, "SKILL.md"), "utf8");
    const description = /^description: (.*)$/m.exec(skill)?.[1] ?? "";
    expect(description.match(V4_VERSION)).toEqual([pin]);
  });

  test("the effect-v4 reference submodule is pinned to that version's tag", async () => {
    const gitmodules = await readFile(join(REPO, ".gitmodules"), "utf8");
    const section = /\[submodule "\.claude\/references\/effect-v4"\]([^[]*)/.exec(gitmodules)?.[1];
    const branch = /^\s*branch = (.+)$/m.exec(section ?? "")?.[1]?.trim();
    expect(branch).toBe(`effect@${pin}`);
  });
});
