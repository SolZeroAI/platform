# `slop-scan` Notes

Reference repo: [benvinegar/slop-scan](https://github.com/benvinegar/slop-scan)

## Purpose

`slop-scan` is a deterministic CLI for finding explainable AI-associated slop patterns in JavaScript and TypeScript repositories. It is a slop scanner, not an authorship detector.

Use it to surface hotspots quickly, inspect why code was flagged, and compare suspicious density across repos with normalized metrics.

## Useful Commands

```bash
slop-scan scan .
slop-scan scan . --lint
slop-scan scan . --json
slop-scan scan ./path --ignore "tests/**"
```

Local development install patterns:

```bash
nub add -D slop-scan
nub exec slop-scan scan . --lint
```

## Common Hotspots

The upstream tool currently focuses on patterns such as:

- log-and-continue or empty catch blocks
- error-obscuring catches
- async wrapper and `return await` noise
- pass-through wrappers
- barrel density
- duplicate helper or function signatures
- over-fragmentation and directory fan-out hotspots
- placeholder comments
- duplicated test setup or mocks

## Config Files

The tool looks for these from the scan root:

- `slop-scan.config.ts`
- `slop-scan.config.js`
- `slop-scan.config.mjs`
- `slop-scan.config.cjs`
- `slop-scan.config.json`
- `repo-slop.config.ts`
- `repo-slop.config.js`
- `repo-slop.config.mjs`
- `repo-slop.config.cjs`
- `repo-slop.config.json`

Config can define:

- `ignores`
- `plugins`
- `extends`
- `rules`
- `overrides`

## Interpretation Guidance

- Treat findings as explainable heuristics, not proof.
- Prioritize hotspots in changed files and their immediate context.
- Prefer a focused human cleanup pass over mass mechanical rewrites.
- Do not optimize code to satisfy the scanner if the result hurts repo fit or clarity.
