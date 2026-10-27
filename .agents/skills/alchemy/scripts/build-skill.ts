#!/usr/bin/env bun
/**
 * Deterministically (re)builds the alchemy skill's reference corpus.
 *
 *   bun scripts/build-skill.ts              # fetch upstream, rebuild
 *   bun scripts/build-skill.ts --check      # rebuild in memory, exit 1 if stale
 *   bun scripts/build-skill.ts --ref <ref>  # pin to a branch, tag, or commit
 *   bun scripts/build-skill.ts --src <dir>  # build from an existing checkout (no network)
 *
 * Source
 *   github.com/alchemy-run/alchemy -> website/src/content/docs/**.{md,mdx}
 *
 * Why the repo and not https://alchemy.run/llms.txt: llms.txt is a curated
 * navigation index, but it lags the repo. At the time of writing it omits 65
 * live pages (all of fly/compute, hetzner, railway, prisma, and more), and
 * llms-full.txt is not full text at all -- it is a larger link index. The repo
 * is complete, carries `title` + `description` frontmatter on every page, and
 * is the thing the site is built from.
 *
 * Not in this corpus: the ~4,100 per-resource API reference pages under
 * `/providers/*`. They are generated at build time from JSDoc in
 * `packages/alchemy/src/**` and are not git-tracked, so there is nothing to
 * clone. They are served, including as raw markdown at
 * `https://alchemy.run/providers/<cloud>/<service>/<resource>.md`, which is
 * what SKILL.md tells the model to fetch for exact resource props.
 *
 * Ownership: this script owns `references/**.md`, every `references/*\/INDEX.md`,
 * `references/manifest.json`, and the regions of SKILL.md between
 * `<!-- BEGIN GENERATED: x -->` and `<!-- END GENERATED: x -->`. Everything
 * else in SKILL.md is hand-authored judgement and is never touched.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { convertMdx, splitFrontmatter } from "./lib/mdx.ts";

const SKILL = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const REFS = join(SKILL, "references");
const CACHE = join(SKILL, ".cache");
const CHECKOUT = join(CACHE, "upstream");

const REPO = "https://github.com/alchemy-run/alchemy.git";
const DOCS_PREFIX = "website/src/content/docs";
const VERSIONS_FILE = "website/src/versions.ts";
const PKG_FILE = "packages/alchemy/package.json";
/** The repo-wide `overrides.effect` here is the exact Effect release alchemy is
 *  built and tested against; `versions.ts` only carries the `rc` dist-tag. */
const WORKSPACE_FILE = "pnpm-workspace.yaml";
const SITE = "https://alchemy.run";

/** Upstream directories excluded from the corpus. Release notes are 445 KB of
 *  point-in-time changelog; the skill answers how alchemy works *now*. */
const EXCLUDE_DIRS = new Set(["blog"]);

/** Areas whose upstream directory has no `index.mdx` to borrow a summary from.
 *  The only editorial call in this script; the report flags new gaps. */
const AREA_BLURB: Record<string, string> = {
  "(root)": "Entry points: what alchemy is, first deploy, and the v1 -> v2 migration.",
  environments: "Stages, per-environment config, secrets, local dev, and CI.",
  "infrastructure-as-code":
    "The noun graph: Stacks, Resources, Actions, Outputs, references, lifecycle, providers.",
  "infrastructure-as-effects":
    "One Effect program models runtime code and infrastructure: Runtimes carry code, Bindings wire resources into them, Phases split deploy from runtime, and Layers package it behind typed services.",
  "project-structure": "How to lay out single-stack and multi-stack repos.",
};

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const opt = (f: string) => {
  const i = argv.indexOf(f);
  return i === -1 ? undefined : argv[i + 1];
};

const CHECK = has("--check");
const REF = opt("--ref") ?? "main";
const SRC = opt("--src");

/**
 * An expected failure in an upstream source or generated artifact operation.
 */
export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const io = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new BuildError({ operation, cause }),
  });

/**
 * Reads an upstream or generated text file lazily with a typed failure.
 *
 * @param file - File to read.
 * @returns An Effect yielding the UTF-8 file contents.
 */
export const readText = Effect.fn("alchemy.readText")(function* (file: string) {
  return yield* io(`read ${file}`, () => readFile(file, "utf8"));
});

const readDirectory = Effect.fn("alchemy.readDirectory")(function* (path: string) {
  return yield* io(`read directory ${path}`, () => readdir(path, { recursive: true }));
});

const makeDirectory = Effect.fn("alchemy.makeDirectory")(function* (path: string) {
  yield* io(`create directory ${path}`, () => mkdir(path, { recursive: true }));
});

const writeText = Effect.fn("alchemy.writeText")(function* (file: string, text: string) {
  yield* io(`write ${file}`, () => writeFile(file, text));
});

const removeFile = Effect.fn("alchemy.removeFile")(function* (file: string) {
  yield* io(`remove ${file}`, () => rm(file));
});

const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

/* --------------------------------------------------------------------- git */

/**
 * Repository-location variables. `git -C <dir>` does not override them: with
 * `GIT_DIR` set, git resolves the repository from the environment and treats
 * `-C` as a plain chdir. Git exports these into hook environments, so a script
 * run from a lefthook hook would otherwise clone into, and check out over,
 * this repository. Duplicated from the workspaces skill's `lib/git-env.ts` on
 * purpose: skills install independently, so importing across skill directories
 * would break this one when it ships alone.
 */
const GIT_ENV_KEYS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
]);

const cleanGitEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && !GIT_ENV_KEYS.has(e[0]),
    ),
  );

const git = Effect.fn("alchemy.git")(function* (args: string[], cwd?: string) {
  const result = yield* Effect.try({
    try: () =>
      Bun.spawnSync(["git", ...args], {
        cwd,
        env: cleanGitEnv(),
        timeout: 120_000,
        stdio: [null, "pipe", "pipe"],
      }),
    catch: (cause) => new BuildError({ operation: `git ${args.join(" ")}`, cause }),
  });
  if (result.exitCode !== 0) {
    return yield* new BuildError({
      operation: `git ${args.join(" ")}`,
      cause: result.stderr.toString().trim(),
    });
  }
  return result.stdout.toString().trim();
});

/** Sparse, blobless checkout of just the paths we read. Cheap to refresh. */
const syncCheckout = Effect.fn("alchemy.syncCheckout")(function* () {
  if (!existsSync(join(CHECKOUT, ".git"))) {
    yield* git(["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, CHECKOUT]);
    yield* git(
      ["sparse-checkout", "set", "--no-cone", DOCS_PREFIX, VERSIONS_FILE, PKG_FILE, WORKSPACE_FILE],
      CHECKOUT,
    );
  }
  // Existing checkouts predate WORKSPACE_FILE in the sparse set; re-applying is idempotent.
  yield* git(
    ["sparse-checkout", "set", "--no-cone", DOCS_PREFIX, VERSIONS_FILE, PKG_FILE, WORKSPACE_FILE],
    CHECKOUT,
  );
  yield* git(["fetch", "--depth", "1", "origin", REF], CHECKOUT);
  yield* git(["checkout", "--detach", "--force", "FETCH_HEAD"], CHECKOUT);
  return CHECKOUT;
});

/* ------------------------------------------------------------------- source */

/** Wrap a long list of slugs into fenced, readable columns. */
function wrap(items: string[], width = 88): string[] {
  const out: string[] = [];
  let line = "";
  for (const it of items) {
    if (line && line.length + it.length + 1 > width) {
      out.push(line);
      line = "";
    }
    line = line ? `${line} ${it}` : it;
  }
  if (line) out.push(line);
  return out;
}

const program = Effect.gen(function* () {
  const root = SRC ?? (yield* syncCheckout());
  const docsDir = join(root, DOCS_PREFIX);
  if (!existsSync(docsDir)) {
    return yield* new BuildError({ operation: "build", cause: `no docs at ${docsDir}` });
  }

  const sourceRev = existsSync(join(root, ".git"))
    ? {
        sha: yield* git(["rev-parse", "--short", "HEAD"], root),
        date: yield* git(["log", "-1", "--format=%cs"], root),
      }
    : { sha: "unknown", date: "unknown" };

  /** `effectVersion` and `alchemyVersion` are interpolated into install commands
   *  in the MDX. Read them rather than hardcoding a version that will rot. */
  const presetVars = new Map<string, string>();
  {
    const vf = join(root, VERSIONS_FILE);
    if (existsSync(vf)) {
      const text = yield* readText(vf);
      for (const m of text.matchAll(/^export const (\w+) = "([^"]*)";/gm)) {
        presetVars.set(m[1]!, m[2]!);
      }
    }
    const pf = join(root, PKG_FILE);
    if (existsSync(pf)) {
      const v = (JSON.parse(yield* readText(pf)) as { version?: string }).version;
      if (v) presetVars.set("alchemyVersion", v);
    }
  }
  const alchemyVersion = presetVars.get("alchemyVersion") ?? "unknown";

  /** The effect-ts skill must document this exact version; see
   *  `effect-version.test.ts`, which fails when the two drift. */
  const wf = join(root, WORKSPACE_FILE);
  if (!existsSync(wf)) {
    return yield* new BuildError({ operation: "build", cause: `no ${WORKSPACE_FILE} at ${wf}` });
  }
  const ws = parseYaml(yield* readText(wf)) as { overrides?: Record<string, unknown> };
  const effectPin = ws.overrides?.effect;
  if (typeof effectPin !== "string" || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(effectPin)) {
    return yield* new BuildError({
      operation: "build",
      cause: `${WORKSPACE_FILE}: overrides.effect is not an exact version (${String(effectPin)})`,
    });
  }

  /* --------------------------------------------------------------------- walk */

  type Entry = {
    title: string;
    description: string;
    area: string;
    group: string;
    slug: string;
    path: string;
    upstream: string;
    url: string;
    lines: number;
    bytes: number;
    body: string;
  };

  const docFiles = (yield* readDirectory(docsDir))
    .filter((p) => /\.mdx?$/.test(p))
    .filter((p) => !EXCLUDE_DIRS.has(p.split("/")[0]!))
    .toSorted();

  const entries: Entry[] = [];

  for (const rel of docFiles) {
    const src = yield* readText(join(docsDir, rel));
    const { fm, body } = splitFrontmatter(src);
    const title = typeof fm.title === "string" ? fm.title : "";
    const description = typeof fm.description === "string" ? fm.description : "";
    if (!title) warn(`${rel}: no frontmatter title`);

    const text = convertMdx(body, { file: rel, presets: presetVars, onWarn: warn });

    const noExt = rel.replace(/\.mdx?$/, "");
    const isIndex = /(^|\/)index$/.test(noExt);
    const slug = isIndex ? noExt.replace(/(^|\/)index$/, "") : noExt;
    const parts = noExt.split("/");
    const area = parts.length > 1 ? parts[0]! : "(root)";
    const group = parts.length > 2 ? parts[1]! : "";
    const localPath = isIndex ? `${noExt.replace(/index$/, "")}_overview` : noExt;

    const rendered =
      `<!-- source: ${SITE}/${slug}\n` +
      `     upstream: ${DOCS_PREFIX}/${rel}\n` +
      `     alchemy ${alchemyVersion} @ ${sourceRev.sha} -->\n\n` +
      `# ${title}\n\n` +
      (description ? `> ${description}\n\n` : "") +
      text;

    entries.push({
      title,
      description,
      area,
      group,
      slug,
      path: `references/${localPath}.md`,
      upstream: `${DOCS_PREFIX}/${rel}`,
      url: `${SITE}/${slug}`,
      lines: rendered.split("\n").length,
      bytes: Buffer.byteLength(rendered),
      body: rendered,
    });
  }

  if (!entries.length) {
    return yield* new BuildError({ operation: "build", cause: "no documentation pages found" });
  }

  const dupes = entries.map((e) => e.path).filter((p, i, a) => a.indexOf(p) !== i);
  if (dupes.length) {
    return yield* new BuildError({
      operation: "build",
      cause: `path collision: ${[...new Set(dupes)].join(", ")}`,
    });
  }

  /* ------------------------------------------------------------------ indexes */

  const areas = [...new Set(entries.map((e) => e.area))].toSorted((a, b) =>
    a === "(root)" ? -1 : b === "(root)" ? 1 : a < b ? -1 : 1,
  );
  const byArea = (a: string) => entries.filter((e) => e.area === a);

  /** Area summary: the upstream `index.mdx` description when there is one. */
  function areaBlurb(area: string): string {
    const overview = byArea(area).find((e) => e.path.endsWith("/_overview.md") && !e.group);
    const blurb = overview?.description || AREA_BLURB[area] || "";
    if (!blurb) warn(`area "${area}" has no index page and no AREA_BLURB entry`);
    return blurb;
  }

  /** Path relative to an area's INDEX.md, e.g. `compute/workers.md`. */
  const inArea = (e: Entry) =>
    e.path.replace(`references/${e.area}/`, "").replace("references/", "");

  function renderAreaIndex(area: string): string {
    const list = byArea(area).toSorted((a, b) => (a.path < b.path ? -1 : 1));
    const groups = [...new Set(list.map((e) => e.group))].toSorted();
    const out = [`# ${area} index`, "", `${list.length} pages. ${areaBlurb(area)}`.trim(), ""];
    for (const g of groups) {
      if (g) out.push(`## ${g}/`, "");
      out.push("| Page | File | Covers |", "| --- | --- | --- |");
      for (const e of list.filter((x) => x.group === g)) {
        out.push(`| ${e.title} | \`${inArea(e)}\` | ${e.description.replace(/\|/g, "\\|")} |`);
      }
      out.push("");
    }
    return (
      out
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n"
    );
  }

  /* ------------------------------------------------- generated SKILL.md regions */

  function regionStats(): string {
    return [
      `Indexed from \`alchemy-run/alchemy\` @ \`${sourceRev.sha}\` (${sourceRev.date}), ` +
        `alchemy \`${alchemyVersion}\` on \`effect@${effectPin}\`: **${entries.length} topic files** across ` +
        `${areas.length} areas.`,
      "",
      "Reference paths mirror site URLs exactly, so a path is derivable without",
      "searching: `https://alchemy.run/cloudflare/compute/workers` ->",
      "`references/cloudflare/compute/workers.md`. A section landing page is",
      "`_overview.md` (`https://alchemy.run/cli` -> `references/cli/_overview.md`).",
    ].join("\n");
  }

  function regionRouting(): string {
    const out: string[] = [];

    out.push("### Start here", "");
    for (const e of byArea("(root)").toSorted((a, b) => (a.path < b.path ? -1 : 1))) {
      out.push(`- \`${e.path}\` -- ${e.description}`);
    }

    // Bullets, not a table: oxfmt pads table columns, which would fight this
    // script over the file on every run.
    out.push("", "### Areas", "");
    for (const a of areas) {
      if (a === "(root)") continue;
      out.push(`- \`references/${a}/\` (${byArea(a).length}) -- ${areaBlurb(a)}`);
    }
    out.push(
      "",
      "Each area has an `INDEX.md` listing every page with what it covers. Read",
      "it only to disambiguate; read the topic file to answer.",
      "",
      "### Page map",
      "",
      "Every page in the corpus. Append `.md` and prefix `references/<area>/`.",
      "",
      "```",
    );

    // One fenced block for all areas: 22 separate blocks cost ~90 lines of
    // headers and blank lines, which the 500-line SKILL.md budget cannot spare.
    const label = Math.max(...areas.map((a) => a.length)) + 2;
    for (const a of areas) {
      if (a === "(root)") continue;
      const slugs = byArea(a)
        .toSorted((x, y) => (x.path < y.path ? -1 : 1))
        .map((e) => inArea(e).replace(/\.md$/, ""));
      const [first, ...rest] = wrap(slugs, 88 - label);
      out.push(`${`${a}/`.padEnd(label)}${first}`);
      for (const line of rest) out.push(`${" ".repeat(label)}${line}`);
    }
    out.push("```");

    return out.join("\n").trimEnd();
  }

  const REGIONS: Record<string, string> = {
    "corpus-stats": regionStats(),
    routing: regionRouting(),
  };

  function injectRegions(skill: string): string {
    let out = skill;
    for (const [name, content] of Object.entries(REGIONS)) {
      const re = new RegExp(
        `(<!-- BEGIN GENERATED: ${name} -->)[\\s\\S]*?(<!-- END GENERATED: ${name} -->)`,
      );
      if (!re.test(out)) {
        warn(`SKILL.md has no "${name}" generated region`);
        continue;
      }
      out = out.replace(re, `$1\n\n${content}\n\n$2`);
    }
    return out;
  }

  /* -------------------------------------------------------------------- write */

  const manifest = {
    source: { repo: REPO, ref: REF, ...sourceRev, alchemyVersion, effectVersion: effectPin },
    generated: entries.length,
    pages: entries.map(({ body: _b, ...m }) => m),
  };
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";

  const skillPath = join(SKILL, "SKILL.md");
  const skillText = existsSync(skillPath) ? injectRegions(yield* readText(skillPath)) : null;

  const artifacts = new Map<string, string>();
  for (const e of entries) artifacts.set(join(SKILL, e.path), e.body);
  for (const a of areas) {
    if (a === "(root)") continue;
    artifacts.set(join(REFS, a, "INDEX.md"), renderAreaIndex(a));
  }
  artifacts.set(join(REFS, "manifest.json"), manifestText);
  if (skillText !== null) artifacts.set(skillPath, skillText);

  if (CHECK) {
    const stale: string[] = [];
    for (const [file, want] of artifacts) {
      if (!existsSync(file) || (yield* readText(file)) !== want) {
        stale.push(file.replace(`${SKILL}/`, ""));
      }
    }
    if (stale.length) {
      console.error(`stale (${stale.length}):\n  ${stale.slice(0, 40).join("\n  ")}`);
      process.exit(1);
    }
    console.log(`up to date: ${entries.length} reference files`);
    process.exit(0);
  }

  // Remove generated files that upstream no longer has. Only `.md` under
  // `references/` is ours, and `manifest.json`; nothing else is touched.
  if (existsSync(REFS)) {
    for (const rel of yield* readDirectory(REFS)) {
      const full = join(REFS, rel);
      if (!rel.endsWith(".md") || artifacts.has(full)) continue;
      yield* removeFile(full);
    }
  }

  for (const [file, content] of artifacts) {
    yield* makeDirectory(dirname(file));
    yield* writeText(file, content);
  }

  /* ------------------------------------------------------------------- report */

  const outKB = entries.reduce((t, e) => t + e.bytes, 0) / 1024;
  console.log(
    `\n${entries.length} reference files (${outKB.toFixed(0)} KB) from ` +
      `alchemy ${alchemyVersion} @ ${sourceRev.sha} (${sourceRev.date})\n`,
  );
  for (const a of areas) {
    console.log(`  ${a.padEnd(28)}${String(byArea(a).length).padStart(4)}`);
  }

  if (skillText === null) console.log("\n  SKILL.md not found; generated regions not written.");
  else console.log("\n  SKILL.md generated regions updated.");

  // Hand-authored prose in SKILL.md may name a topic file directly. A renamed
  // upstream slug silently breaks that; report it rather than guessing a fix.
  if (skillText !== null) {
    const outside = skillText.replace(
      /<!-- BEGIN GENERATED:[\s\S]*?<!-- END GENERATED: \w[\w-]* -->/g,
      "",
    );
    const broken = [...outside.matchAll(/`(references\/[\w./-]+\.md)`/g)]
      .map((m) => m[1]!)
      .filter((p) => !existsSync(join(SKILL, p)));
    if (broken.length) {
      console.log(`\n  SKILL.md prose references ${broken.length} missing file(s):`);
      console.log(`    ${[...new Set(broken)].join(", ")}`);
    }
  }

  if (warnings.length) {
    const shown = [...new Set(warnings)];
    console.log(`\n  ${warnings.length} warning(s):`);
    for (const w of shown.slice(0, 25)) console.log(`    ${w}`);
    if (shown.length > 25) console.log(`    ... and ${shown.length - 25} more`);
  }
  console.log();
});

if (import.meta.main) {
  Effect.runPromise(program).catch((error) => {
    if (error instanceof BuildError) {
      const message =
        error.operation === "build"
          ? String(error.cause)
          : `${error.operation}: ${String(error.cause)}`;
      console.error(`\n  ERROR  ${message}\n`);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
