---
name: tsrs
description: >-
  Typecheck with tsrs, the Rust port of the TypeScript 7 compiler. Use when a
  project depends on tsrs, typechecks with tsrs, or points its editor at the
  tsrs tsdk. Prefer the package API when embedding the compiler.
---

# Use tsrs

`tsrs` is a drop-in for the TypeScript 7 compiler (`tsc`). It reads `tsconfig.json` and reports diagnostics for the TypeScript commit named in `tsrs --help`. The package version ends in `-ts<TypeScript version>`, for example `0.20.1-ts7.1.0-beta`.

Typecheck with the project's typecheck script. In this repository that script is `tsrs --noEmit`, run with `nub run typecheck`. Keep that script on `tsrs`. `--fast` turns on performance modes that can disagree with the pinned TypeScript compiler. Leave it off for a normal typecheck.

`tsrs -p <project>` selects a config, the same way `tsc -p` does. Other `tsc` flags pass through.

## Editor

When the workspace already sets the TypeScript SDK, keep it on this package:

```json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/tsrs/tsdk"
}
```

A local editor link under `.vscode/tsrs/` stays untracked. A committed symlink into `node_modules` makes action checkouts stop.

## Programmatic API

Embed the compiler through the package instead of spawning `tsrs`. `tsrs/sync` and `tsrs/async` export the `API` client. Related surfaces are `tsrs/fs`, `tsrs/path`, and `tsrs/ast`. Read the `exports` map in `node_modules/tsrs/package.json` before importing a path. A repository typecheck still goes through the typecheck script.
