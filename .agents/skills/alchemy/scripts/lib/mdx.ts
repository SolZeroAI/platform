/**
 * Converts one upstream Alchemy docs page (Astro Starlight MDX) into the plain
 * markdown the skill's reference corpus is made of.
 *
 * Upstream uses exactly nine block-level components. Everything else on a page
 * is already plain markdown, so this is a narrow, enumerated rewrite rather
 * than a general MDX parser:
 *
 *   Tabs / TabItem     package-manager variants, or a real choice (Neon vs ...)
 *   Code               a one-line command, sometimes with `${scope}` values
 *   Terminal           a recorded TUI frame with colour-span markers
 *   DAG                a dependency diagram given as nodes and edges
 *   Steps              a numbered wrapper with no text of its own
 *   DeployWorkflow     a computed CI workflow with no static source
 *   StateStoreBootstrap / StackOutputsTerminal   interactive islands
 *
 * Every pass is fence-aware. Example code is full of `<T>` generics and
 * `import` lines, and none of it may be mistaken for MDX module syntax.
 */
import { parse as parseYaml } from "yaml";

export type Frontmatter = Record<string, unknown>;

export type ConvertOptions = {
  /** Upstream-relative path, used only in warning messages. */
  file: string;
  /** Values reachable by `${ident}`, e.g. `effectVersion` from versions.ts. */
  presets?: ReadonlyMap<string, string>;
  onWarn?: (message: string) => void;
};

type Ctx = {
  file: string;
  vars: Map<string, string>;
  presets: ReadonlyMap<string, string>;
  warn: (message: string) => void;
};

const FENCE = /^\s*(`{3,}|~{3,})/;

/** The fence state after `line`, or `false` when the line is not a fence. */
function fenceAfter(line: string, fence: string | null): string | null | false {
  const m = line.match(FENCE);
  if (!m) return false;
  const ch = m[1]![0]!;
  return fence === null ? ch : ch === fence ? null : fence;
}

export function splitFrontmatter(src: string): { fm: Frontmatter; body: string[] } {
  const lines = src.split("\n");
  if (lines[0]?.trim() !== "---") return { fm: {}, body: lines };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { fm: {}, body: lines };
  const fm = (parseYaml(lines.slice(1, end).join("\n")) ?? {}) as Frontmatter;
  return { fm, body: lines.slice(end + 1) };
}

const braceDelta = (l: string) => (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);

/** Resolve a JS string literal, substituting `${ident}` from the MDX scope. */
function evalLiteral(raw: string, ctx: Ctx): string {
  const t = raw.trim();
  const quoted =
    (t.startsWith("`") && t.endsWith("`")) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"));
  if (!quoted) ctx.warn(`${ctx.file}: unrecognised literal ${t.slice(0, 40)}`);
  const inner = quoted ? t.slice(1, -1) : t;
  return inner.replace(/\$\{(\w+)\}/g, (whole, name: string) => {
    const v = ctx.vars.get(name) ?? ctx.presets.get(name);
    if (v === undefined) {
      ctx.warn(`${ctx.file}: unresolved \${${name}}`);
      return whole;
    }
    return v;
  });
}

/**
 * Drop MDX module syntax (component imports and the `export function` that
 * renders a computed code block) while recording the `export const` scope
 * values that `<Code code={...} />` interpolates.
 */
function stripModuleSyntax(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  let fnDepth = 0;

  for (const line of lines) {
    const next = fenceAfter(line, fence);
    if (next !== false) {
      fence = next;
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }
    if (fnDepth > 0) {
      fnDepth += braceDelta(line);
      continue;
    }
    if (/^import\s/.test(line)) continue;
    if (/^export\s+(default\s+)?(async\s+)?function\b/.test(line)) {
      fnDepth = Math.max(braceDelta(line), 0);
      continue;
    }
    const ec = line.match(/^export const (\w+)\s*=\s*(.+?);?\s*$/);
    if (ec) {
      if (!line.trimEnd().endsWith(";")) {
        ctx.warn(`${ctx.file}: multi-line export const ${ec[1]}`);
      }
      ctx.vars.set(ec[1]!, evalLiteral(ec[2]!, ctx));
      continue;
    }
    out.push(line);
  }

  if (fnDepth > 0) {
    throw new Error(`${ctx.file}: unbalanced braces while skipping an export function`);
  }
  return out;
}

const codeBlock = (lang: string, code: string) => ["```" + lang, code.replace(/\s+$/, ""), "```"];

/**
 * Terminal renders a recorded TUI frame. `[g]`/`[/g]` and friends are colour
 * spans and `[sN]` is an N-space indent. CLI placeholders such as `[options]`
 * and `[stage]` are not markers and must survive untouched.
 */
function renderTerminal(content: string): string[] {
  const text = content
    .replace(/\[s(\d+)\]/g, (_, n: string) => " ".repeat(Number(n)))
    .replace(/\[\/?(?:u|b|d|g|y|r|c|m)\]/g, "");
  return codeBlock("text", text);
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.match(/^ */)![0]!.length);
  const n = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => (l.trim() === "" ? "" : l.slice(n)));
}

const PKG_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

type Tab = { label: string; lines: string[] };

function renderComponents(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  let i = 0;

  /** Consume a possibly multi-line self-closing element starting at `i`. */
  const takeElement = (): string => {
    const buf: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      buf.push(l);
      i++;
      if (l.trimEnd().endsWith("/>")) break;
    }
    return buf.join("\n");
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const next = fenceAfter(line, fence);
    if (next !== false) {
      fence = next;
      out.push(line);
      i++;
      continue;
    }
    if (fence !== null) {
      out.push(line);
      i++;
      continue;
    }

    const t = line.trim();

    if (t.startsWith("<Tabs")) {
      const syncKey = t.match(/syncKey="([^"]+)"/)?.[1] ?? "";
      const inner: string[] = [];
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        const l = lines[i]!;
        if (l.trim().startsWith("<Tabs")) depth++;
        else if (l.trim().startsWith("</Tabs>")) depth--;
        if (depth > 0) inner.push(l);
        i++;
      }
      out.push(...renderTabs(inner, syncKey, ctx));
      continue;
    }

    if (t.startsWith("<Code")) {
      const el = takeElement();
      const lang = el.match(/lang="([^"]+)"/)?.[1] ?? "sh";
      const raw =
        el.match(/code=\{(`[\s\S]*?`)\}/)?.[1] ?? el.match(/code=("(?:[^"\\]|\\.)*")/)?.[1];
      if (raw === undefined) {
        ctx.warn(`${ctx.file}: <Code> without a readable code attribute`);
        continue;
      }
      out.push(...codeBlock(lang, evalLiteral(raw, ctx)));
      continue;
    }

    if (t.startsWith("<Terminal")) {
      const el = takeElement();
      const raw = el.match(/content=\{`([\s\S]*?)`\}/)?.[1];
      if (raw === undefined) {
        ctx.warn(`${ctx.file}: <Terminal> without readable content`);
        continue;
      }
      out.push(...renderTerminal(raw));
      continue;
    }

    if (t.startsWith("<DAG")) {
      out.push(...codeBlock("text", `Diagram (nodes and edges as authored):\n${takeElement()}`));
      continue;
    }

    if (t.startsWith("<Steps>") || t.startsWith("</Steps>")) {
      i++;
      continue;
    }

    // Interactive islands and the computed CI workflow renderer have no static
    // text. Point at the live page rather than dropping them silently.
    if (/^<(StateStoreBootstrap|StackOutputsTerminal|DeployWorkflow)\b/.test(t)) {
      const name = t.match(/^<(\w+)/)![1]!;
      takeElement();
      out.push(`> Interactive \`${name}\` widget; see the live page for its rendered output.`);
      continue;
    }

    out.push(line);
    i++;
  }

  return out;
}

function renderTabs(inner: string[], syncKey: string, ctx: Ctx): string[] {
  const tabs: Tab[] = [];
  let cur: Tab | null = null;
  for (const l of inner) {
    const open = l.trim().match(/^<TabItem[^>]*label="([^"]+)"/);
    if (open) {
      cur = { label: open[1]!, lines: [] };
      continue;
    }
    if (l.trim().startsWith("</TabItem>")) {
      if (cur) tabs.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.lines.push(l);
  }
  if (!tabs.length) return renderComponents(inner, ctx);

  const body = (tab: Tab) => renderComponents(dedent(tab.lines), ctx);

  // A package-manager group is one command written four ways. Keep bun.
  const isPkgManager = syncKey === "pkgManager" || tabs.every((tab) => PKG_MANAGERS.has(tab.label));
  if (isPkgManager) return body(tabs.find((tab) => tab.label === "bun") ?? tabs[0]!);

  const out: string[] = [];
  for (const tab of tabs) {
    out.push(`**${tab.label}**`, "");
    out.push(...body(tab));
    out.push("");
  }
  return out;
}

/** Collapse blank runs outside fences, strip trailing whitespace, and trim. */
function tidy(lines: string[]): string {
  const out: string[] = [];
  let fence: string | null = null;
  let blanks = 0;
  for (const l of lines) {
    const next = fenceAfter(l, fence);
    if (next !== false) {
      fence = next;
      out.push(l);
      blanks = 0;
      continue;
    }
    if (fence !== null) {
      out.push(l);
      continue;
    }
    if (l.trim() === "") {
      if (++blanks > 1) continue;
      out.push("");
      continue;
    }
    blanks = 0;
    out.push(l.trimEnd());
  }
  // The loop above already collapsed blank runs outside fences. A global
  // `\n{3,}` pass here would also squash deliberate blank lines *inside*
  // example code, so there is none.
  return out.join("\n").trim() + "\n";
}

/** Convert a frontmatter-stripped MDX body to markdown. Ends with a newline. */
export function convertMdx(body: string[], options: ConvertOptions): string {
  const ctx: Ctx = {
    file: options.file,
    vars: new Map(),
    presets: options.presets ?? new Map(),
    warn: options.onWarn ?? (() => {}),
  };
  return tidy(renderComponents(stripModuleSyntax(body, ctx), ctx));
}
