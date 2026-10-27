import { describe, expect, it } from "bun:test";
import { convertMdx, splitFrontmatter } from "./mdx.ts";

/** Convert a whole MDX document the way build-skill.ts does. */
function convert(src: string, presets?: Record<string, string>) {
  const warnings: string[] = [];
  const { fm, body } = splitFrontmatter(src);
  const text = convertMdx(body, {
    file: "test.mdx",
    presets: new Map(Object.entries(presets ?? {})),
    onWarn: (m) => warnings.push(m),
  });
  return { fm, text, warnings };
}

describe("splitFrontmatter", () => {
  it("returns the parsed frontmatter and the body after it", () => {
    const { fm, body } = splitFrontmatter(
      "---\ntitle: Workers\ndescription: Compute.\n---\n\n# Hi\n",
    );
    expect(fm).toEqual({ title: "Workers", description: "Compute." });
    expect(body).toEqual(["", "# Hi", ""]);
  });

  it("treats a document with no frontmatter as all body", () => {
    const { fm, body } = splitFrontmatter("# Hi\n");
    expect(fm).toEqual({});
    expect(body).toEqual(["# Hi", ""]);
  });
});

describe("package-manager tabs", () => {
  const src = [
    "---",
    "title: Install",
    "---",
    "",
    'import { Code, Tabs, TabItem } from "@astrojs/starlight/components";',
    'import { effectVersion } from "../../versions";',
    "",
    "export const pkgs = `alchemy@latest effect@${effectVersion}`;",
    "",
    '<Tabs syncKey="pkgManager">',
    '  <TabItem label="bun" icon="bun">',
    '    <Code code={`bun add ${pkgs}`} lang="sh" />',
    "  </TabItem>",
    '  <TabItem label="npm" icon="npm">',
    '    <Code code={`npm install ${pkgs}`} lang="sh" />',
    "  </TabItem>",
    "</Tabs>",
    "",
  ].join("\n");

  it("keeps only the bun command and resolves interpolated scope values", () => {
    const { text, warnings } = convert(src, { effectVersion: "rc" });
    expect(text).toBe("```sh\nbun add alchemy@latest effect@rc\n```\n");
    expect(warnings).toEqual([]);
  });

  it("warns and preserves the placeholder when a value is out of scope", () => {
    const { text, warnings } = convert(src);
    expect(text).toBe("```sh\nbun add alchemy@latest effect@${effectVersion}\n```\n");
    expect(warnings).toEqual(["test.mdx: unresolved ${effectVersion}"]);
  });
});

describe("choice tabs", () => {
  it("keeps every tab, labelled, when the group is a real choice", () => {
    const { text } = convert(
      [
        '<Tabs syncKey="db-provider">',
        '  <TabItem label="Neon">',
        "    Use `Neon.Branch`.",
        "  </TabItem>",
        '  <TabItem label="PlanetScale (MySQL)">',
        "    Use `Planetscale.Branch`.",
        "  </TabItem>",
        "</Tabs>",
      ].join("\n"),
    );
    expect(text).toBe(
      "**Neon**\n\nUse `Neon.Branch`.\n\n**PlanetScale (MySQL)**\n\nUse `Planetscale.Branch`.\n",
    );
  });
});

describe("Terminal frames", () => {
  it("strips colour spans, expands [sN] indents, and keeps CLI placeholders", () => {
    const { text } = convert(
      [
        "<Terminal content={`[u]Plan[/u]: [g]1 to create[/g]",
        "{",
        '[s2]url: "x",',
        "}",
        "",
        "alchemy deploy [options]`} />",
      ].join("\n"),
    );
    expect(text).toBe(
      '```text\nPlan: 1 to create\n{\n  url: "x",\n}\n\nalchemy deploy [options]\n```\n',
    );
  });
});

describe("fence awareness", () => {
  it("leaves imports and generics inside example code untouched", () => {
    const src = [
      'import { Code } from "@astrojs/starlight/components";',
      "",
      "```typescript",
      'import * as Effect from "effect/Effect";',
      "",
      "export const x: Output<T> = y;",
      "```",
    ].join("\n");
    const { text } = convert(src);
    expect(text).toBe(
      '```typescript\nimport * as Effect from "effect/Effect";\n\nexport const x: Output<T> = y;\n```\n',
    );
  });
});

describe("structural components", () => {
  it("unwraps Steps", () => {
    const { text } = convert("<Steps>\n\n1. First\n2. Second\n\n</Steps>");
    expect(text).toBe("1. First\n2. Second\n");
  });

  it("renders a DAG as a labelled diagram block", () => {
    const { text } = convert('<DAG\n  nodes={[{ id: "A" }]}\n/>');
    expect(text).toBe(
      '```text\nDiagram (nodes and edges as authored):\n<DAG\n  nodes={[{ id: "A" }]}\n/>\n```\n',
    );
  });

  it("replaces an interactive island with a pointer to the live page", () => {
    const { text } = convert("<StateStoreBootstrap />");
    expect(text).toBe(
      "> Interactive `StateStoreBootstrap` widget; see the live page for its rendered output.\n",
    );
  });

  it("drops an export function that renders computed content", () => {
    const src = [
      "export function DeployWorkflow({ manager = 'bun' }) {",
      "  const content = { a: 1 };",
      '  return <Code lang="yaml" code={content} />;',
      "}",
      "",
      "## Heading",
    ].join("\n");
    expect(convert(src).text).toBe("## Heading\n");
  });

  it("throws when an export function's braces never close", () => {
    expect(() => convert("export function Broken() {\n  const a = {;\n")).toThrow(
      "test.mdx: unbalanced braces while skipping an export function",
    );
  });
});

describe("whitespace", () => {
  it("collapses blank runs outside fences and preserves them inside", () => {
    const { text } = convert("# A\n\n\n\nB\n\n```sh\nx\n\n\n\ny\n```\n");
    expect(text).toBe("# A\n\nB\n\n```sh\nx\n\n\n\ny\n```\n");
  });
});
