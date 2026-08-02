---
name: run-agent-eval
description: Run Agent Eval
disable-model-invocation: true
---

# Run Agent Eval
Run the project agent evaluation loop using `.cursor/skills/agent-eval-loop/SKILL.md`.

## Checklist
- Read `.cursor/skills/agent-eval-loop/SKILL.md` first.
- Read every versioned note in `notes/agent-eval-history/` before choosing a new improvement.
- List available targets with `nub run agent:eval:targets`.
- Search the web for recent Cloudflare updates relevant to Agents SDK, AI Search, Vectorize, Workers AI, or MCP testing before proposing changes.
- Run `nub run agent:eval:local` and `nub run agent:eval:remote` as appropriate for the selected target.
- Score relevance, helpfulness, correctness, and duration.
- If the user wants changes, make the smallest high-signal improvement, rerun the same target, and compare metrics.
- Write a versioned note with `nub run agent:eval:note:write --input <summary-json> --recap "<short recap>"`.

## Outputs
- Eval target used
- Exact commands run
- Local and remote results
- Metric scores and any deltas
- Versioned note path written under `notes/agent-eval-history/`
- Recommended next hypothesis
