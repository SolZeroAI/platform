# project-structure index

4 pages. How to lay out single-stack and multi-stack repos.

| Page | File | Covers |
| --- | --- | --- |
| File layout | `file-layout.md` | How to organize an Alchemy project — one file per Resource or Layer, group Resources that travel together by concern, and keep alchemy.run.ts as the composition root. |
| Multiple Stacks | `monorepo-multi-stack.md` | Each package owns its own alchemy.run.ts. The frontend consumes the backend's deployed outputs through a typed Stack handle, resolved from the state store at plan time, so each package deploys and destroys independently. |
| Single Stack | `monorepo-single-stack.md` | One alchemy.run.ts at the workspace root deploys every app in the monorepo — one plan, one state file, and every path anchored to the file that declares it. |
| Monorepo | `monorepo.md` | Two ways to organize an Alchemy monorepo — one Stack at the workspace root, or one Stack per package wired with typed references. |
