---
name: "deslop-typescript"
description: "Run a final de-slopping pass on nearly finished JavaScript or TypeScript work before commit or PR. Use this skill when a JS/TS change is already functionally correct and you want to reduce AI-style noise, unnecessary wrappers, weak type boundaries, placeholder code, and other `slop-scan` hotspots without widening scope."
---

# Deslop TypeScript

Use this skill after the code works and before commit, PR, or review handoff. The goal is to leave the smallest clear diff that improves readability, type integrity, and repo fit without turning the task into a refactor.

This skill is based on the `slop-scan` model: deterministic slop heuristics for JS/TS repos, plus a review workflow that focuses fixes on worthwhile, local cleanup.

## Goals

- Remove obvious slop without widening scope.
- Prefer compile-time guarantees over runtime ceremony inside typed repo-owned code.
- Collapse unnecessary wrappers, pass-through helpers, and placeholder structure.
- Keep repo conventions, docs, and ownership boundaries intact.

## When To Use

Use this skill when:

- the change is already functionally correct
- the repo is primarily JavaScript or TypeScript
- you want a final cleanup pass before commit or PR
- code feels AI-assisted, over-abstracted, or noisier than the surrounding repo

Do not use this skill when:

- the feature is still incomplete or behavior is still changing
- the task is mostly non-JS/TS code
- the user asked for a broad refactor rather than a narrow cleanup

## Core Review Vectors

Review the changed area through these lenses:

1. Repo conformance
   - Follow repo `AGENTS.md`, nested `AGENTS.md`, design docs, and established local patterns.
   - Prefer the style already present in the touched area over generic cleanup instincts.
2. Type safety and source of truth
   - Preserve canonical types instead of re-declaring or widening them.
   - Remove unnecessary casts, redundant parsing, and boundary checks inside trusted typed code.
   - Keep validation at genuinely untrusted boundaries.
3. Simplicity
   - Remove wrappers, factories, and helpers that only rename or pass through values.
   - Inline trivial indirection when it improves readability locally.
4. Slop hotspots
   - Look for patterns `slop-scan` commonly flags: pass-through wrappers, `return await` noise, placeholder comments, duplicated helpers, fragmented files, weak catch blocks, and repeated setup boilerplate.

## Context Bundle

Before editing, gather only the context that matters for the changed area:

- repo root `AGENTS.md`
- nearest nested `AGENTS.md` files for touched paths
- relevant design docs or architecture notes
- the changed files plus nearby callers, callees, and types
- project scripts or config for lint, typecheck, test, and `slop-scan`

If an active plan or execution doc exists for the work, read it before cleanup so you do not remove intentional structure.

## Scope Selection

Default to the current changed files unless the user explicitly names a branch to deslop against.

For the default scope, inspect local changed JS/TS files from the working tree and index:

```bash
git diff --name-only --diff-filter=ACMR -- '*.js' '*.jsx' '*.ts' '*.tsx'
git diff --cached --name-only --diff-filter=ACMR -- '*.js' '*.jsx' '*.ts' '*.tsx'
git ls-files --others --exclude-standard -- '*.js' '*.jsx' '*.ts' '*.tsx'
```

If the user says to deslop against a branch, use the current checkout compared to that branch. Prefer a local ref when present, then fall back to `origin/<branch>`:

```bash
target_branch="<branch-from-user>"
target_ref="$target_branch"
git rev-parse --verify --quiet "$target_ref" >/dev/null || target_ref="origin/$target_branch"
merge_base="$(git merge-base HEAD "$target_ref")"
git diff --name-only --diff-filter=ACMR "$merge_base" HEAD -- '*.js' '*.jsx' '*.ts' '*.tsx'
```

Use that branch-diff file list to choose the changed area, nearby callers/callees, and any narrow `slop-scan` roots. If local working tree or indexed changes also exist, include them only when they are part of the requested deslop pass or when the user asks for all current changes.

## Slop-Scan Workflow

Use `slop-scan` as a signal source, not as an absolute judge.

1. Detect how to run it.
2. Run a narrow scan on the repo or changed area.
3. Use the findings to identify hotspots.
4. Fix only the issues that are clearly worthwhile and local.
5. Re-run the narrowest relevant validation.

Preferred command order:

```bash
# Repo-installed package
nub exec slop-scan scan . --lint

# Fallback if not installed locally
nub dlx slop-scan scan . --lint
```

When the repo already defines a slop script, prefer that over ad hoc commands.

For machine-readable output:

```bash
nub exec slop-scan scan . --json
```

If the repo has a `slop-scan.config.*` or `repo-slop.config.*`, trust that config as the starting point. Root `.gitignore` is also respected by the tool.

## What To Fix Automatically

Fix these when they are local and clearly better:

- duplicated or widened types
- unnecessary casts
- redundant parsing or revalidation inside trusted typed paths
- pass-through wrappers and dead helpers
- `return await` noise where it adds nothing
- placeholder comments, TODO scaffolding, debug leftovers
- trivial fragmentation that can be collapsed without changing behavior
- weak catch blocks that hide errors or continue ambiguously

## What To Leave Alone

Do not change these unless the user asked for deeper work:

- stable code outside the changed area
- abstractions that encode real ownership or API boundaries
- speculative cleanups with unclear payoff
- large file moves or architectural rewrites
- subjective style changes that do not clearly improve the code

## Working Pattern

1. Read repo guidance and nearby code first.
2. Select scope: default to current changed files, or use a branch diff when the user names a branch to deslop against.
3. Inspect the changed area and identify the likely slop hotspots.
4. Run `slop-scan` if available, plus the narrowest relevant lint/type/test checks.
5. Apply the smallest useful fixes.
6. Re-run the narrowest validations immediately.
7. Keep the final diff focused on deslop work, not unrelated refactors.

## Response Shape

When using this skill, summarize:

- what looked sloppy or risky
- what you fixed
- what you intentionally left alone to avoid widening scope
- what validation you ran, and what you could not run

## References

Open only if needed:

- `references/slop-scan.md` for the underlying tool model and command notes
