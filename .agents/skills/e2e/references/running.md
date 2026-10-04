# Running the repository suite

Run from the repository root with Nub. Prefer committed scripts, which retain the correct target selection and fixture preparation.

```sh
nub run test:e2e:list
nub run test
nub run test:e2e:live
nub run test:e2e:cache-strict
```

Use the app-specific scripts in a monorepo. For a single configured stack, `nub exec e2e run tests/<feature>.e2e.ts` focuses a file; do not bypass the Janus multi-app launcher. `nub exec e2e list --reporter json` collects without starting the app. Read the repository testing inventory for external and provider opt-in flags.

Useful runner options include `--no-cache`, `--strict-cache`, `--tag`, `--exclude-tag`, `--grep`, `--last-failed`, `--target` and `--headed`. The pinned runner's installed API documentation describes their full semantics. Do not use `--pass-with-no-tests` to establish coverage, broad retries to hide product failures, or `--trace` to override credential protection.

Replay recordings live in `.e2e/cache`. An `agent.act` recording needs an immediate assertion and a matching final state. Strict mode rejects stale recordings; steps without a recording may still call Clef. Verify actual model-call/token and replay counts in the report before claiming zero-AI execution. `CF_AI_GATEWAY_E2E_SKIP_CACHE=1` independently bypasses Cloudflare response caching.

Read `.e2e/report.json` and `.e2e/summary.md` (under the app output directory for Janus) after every run. Distinguish discovered, selected, passed, failed, interrupted and skipped counts. Exit zero can include explicitly skipped tests; it does not prove those flows passed.

Use the committed `.github/workflows/validate.yml` for CI. It installs the frozen Nub lockfile and Chromium, runs the real stack, restores/saves verified replay recordings, and uploads sanitized reports/failure evidence. Keep secrets in Actions configuration. Do not upload raw traces, network logs, sessions or unrestricted stack logs, and do not restore unreviewed recordings from other branches.

Repository flow inventory: `docs/e2e.md`.
