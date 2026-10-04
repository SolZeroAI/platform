# Repository setup

Use the committed `e2e.config.ts`, launcher and Nub lockfile. Do not run `e2e init` over this repository: it can replace the adapted skill and configuration.

```sh
nub install --frozen-lockfile
nub run test:e2e:install
nub run test:e2e:list
```

The repository testing inventory documents actual startup commands, exclusive ports, ignored dotenv paths, isolated fixture requirements and CI secrets. The launcher starts the real Alchemy stack and its declared Cloudflare bindings. Preserve its environment allowlist, redaction, readiness checks and process cleanup. Missing credentials, stopped Docker or occupied ports are setup failures; do not replace the stack with a mock or static server.

Semantic steps use `createClefExecutor` from `scripts/e2e/cf-clef-executor.ts`. Cloudflare Clef is a System One decision API, not an AI SDK chat model. It uses the native Workers AI endpoint through AI Gateway with `CLOUDFLARE_ACCOUNT_ID`, `CF_AI_GATEWAY_E2E_TOKEN` and optional `CF_AI_GATEWAY_E2E_ID`. Load these through the committed configuration or CI environment. Never print credentials or expose the gateway token to application/browser processes. No Jev, Vercel Gateway or subscription-model fallback belongs in this suite.

Keep raw browser tracing disabled. The pinned browser SDK cannot register dynamically minted passwords, cookies and tokens for trace redaction. Retain sanitized screenshots/reports and use the reproducible browser SDK permissions patch for genuine Chromium clipboard coverage.

Mobile targets require an actual configured engine and installed runtime. Follow the repository's native iOS recipe when verifying keyboard/Safari chrome behavior; browser device emulation alone does not establish those flows.

Repository flow inventory: `docs/e2e.md`.
