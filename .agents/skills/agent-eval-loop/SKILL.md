---
name: agent-eval-loop
description: Run and improve the c0 agent evaluation loop using the local and remote Cloudflare MCP harness, versioned history notes, and current Cloudflare product updates. Use when evaluating agent quality, harness behavior, retrieval quality, model/tool performance, or when the user asks to benchmark, score, improve, or retest the agent workflow.
---
# Agent Eval Loop

## Purpose
Use this skill to run repeatable agent evaluations, compare outcomes over time, apply targeted improvements, retest, and record versioned results in `notes/agent-eval-history/`.

## Start Here
1. Read every versioned note in `notes/agent-eval-history/` before proposing a new improvement.
2. Extract:
   - what worked
   - what regressed behavior
   - what has already been tried
   - what still looks promising
3. Do not repeat failed ideas unless you have new evidence that changes the hypothesis.

## Pick An Eval Target
List available eval targets first:

```bash
nub run agent:eval:targets
```

Use `--target <id>` to inspect one target:

```bash
nub run agent:eval:targets --target linea-coordinator-runbooks
```

Prefer:
- `configured-ai-search` for narrow retrieval quality and `/mcp` behavior
- `ai-search-mcp-regression` for server, config, and route regressions
- `agent-investigation-loop` for broader multi-step workflows

## Local Versus Remote
- `nub run agent:eval:local` runs the real Worker and `/mcp` route with a deterministic AI mock.
- `nub run agent:eval:remote` runs the real Worker and live Cloudflare retrieval path.
- Treat local runs as harness correctness signals.
- Treat remote runs as live quality signals.
- Never treat a passing local run as proof that live retrieval or live agent quality is correct.

## Required Metrics
Score every eval on a `1-5` scale:
- `relevance`
- `helpfulness`
- `correctness`

Also record:
- `taskDurationMs`
- local run duration when available
- remote run duration when available

Rubric:
- `1`: unusable or misleading
- `2`: weak, incomplete, or mostly off-target
- `3`: acceptable but missing important value
- `4`: strong and useful with minor issues
- `5`: highly effective, correct, and ready to trust

## Web Research
Each eval loop should search the web for recent Cloudflare changes that may improve the harness or implementation:
- Agents SDK
- AI Search
- Vectorize
- Workers AI
- MCP- and Workers-related testing improvements

Capture:
- title
- URL
- why it matters for the current eval target

## Core Loop
1. Read prior notes and summarize the important lessons.
2. Choose a target and define success criteria.
3. Run the relevant local and/or remote harness commands.
4. Review outputs and score the metrics.
5. If the user wants improvement work, make the smallest high-signal change that addresses the current hypothesis.
6. Retest using the same target.
7. Compare metrics and raw evidence.
8. Record a versioned history note.

## Use The Helper Scripts
Create a machine-readable summary first:

```bash
nub run agent:eval:metrics --input /tmp/agent-eval-summary.json --output /tmp/agent-eval-summary.json
```

Preview the next note path:

```bash
nub run agent:eval:note:next --recap "bootstrap-agent-eval-workflow"
```

Write the versioned note and artifact:

```bash
nub run agent:eval:note:write --input /tmp/agent-eval-summary.json --recap "bootstrap-agent-eval-workflow"
```

## Summary Payload Expectations
The input JSON for `agent:eval:metrics` should include:
- `targetId`
- `taskSummary`
- `workflowType`
- `recap`
- `local`
- `remote`
- `metrics`
- `baselineObservations`
- `changesAttempted`
- `worked`
- `didntWork`
- `nextHypotheses`
- `webUpdates`
- `rawEvidence`
- `existingHistoryReviewed`
- `sourceCommands`

See [reference.md](reference.md) for a complete example payload and note shape.

## Output Requirements
For each eval run, produce:
- a concise summary of findings
- exact commands run
- the metric scores
- whether the result came from local or remote harness coverage
- the note path written under `notes/agent-eval-history/`
- the next best hypothesis

## Improvement Guidance
- Prefer one focused change per loop when validating a hypothesis.
- Keep the before/after comparison tight.
- If a change helps locally but not remotely, say so explicitly.
- If a Cloudflare product update suggests a new approach, reference it in both the write-up and the next hypothesis.

## Stop Conditions
Stop the loop when:
- the user only asked for evaluation, not changes
- the remote run is blocked by missing credentials or infrastructure access
- the next change would be speculative without stronger evidence
- you have already reached a clear conclusion for the current target

## Manual Invocation
Use `.cursor/commands/run-agent-eval.md` for a repeatable chat entrypoint.
