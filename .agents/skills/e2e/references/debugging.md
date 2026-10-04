# Diagnose a failed end-to-end run

Read the app's `.e2e/summary.md`, then `.e2e/report.json` and sanitized failure screenshots. Identify the failing phase: collection/configuration, real-stack startup, locator, assertion, provider or cleanup. A collected or skipped test is not runtime verification.

1. Reproduce the smallest actual failing flow with the committed launcher and live mode.
2. Confirm the application route, accessible label and exact HTTP contract.
3. Fix the application when its behavior is wrong; fix the test only when its assumption contradicts that contract.
4. Rerun the regression, then broaden only when changes or unresolved failures justify it.

For startup failures, inspect the launcher's bounded redacted diagnostics, port ownership, Docker availability, dotenv prerequisites and actual readiness endpoint. Keep TLS verification enabled. Use the repository's system-CA setup when required; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

For missing Clef authentication, inspect presence of `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_E2E_TOKEN` without printing values. Do not switch model providers. For oversized observations, preserve masked images and the executor's bounded dimensions rather than dropping secret protection.

Use exact `expect` polling for in-progress state. Do not add sleeps, mocked responses, test-only backend handlers or broad mutation retries. Distinguish transport/provider errors from product failures using actual evidence. Read-only recovery must stay limited to a demonstrated failure signature.

Raw trace recording is disabled because dynamically minted secrets cannot be safely registered with the pinned SDK's trace redactor. Do not override that setting or open/upload old unredacted traces. Sanitized screenshots, reports and owned local logs are the evidence sources. Do not send upstream feedback, issue comments or other external messages unless the human explicitly authorizes them.

Document unavailable fixtures and external-provider failures honestly in the testing inventory. Do not turn a blocker into a passing assertion.

Repository flow inventory: `docs/e2e.md`.
