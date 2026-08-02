# Agent Eval Reference

## Example Summary Payload

```json
{
  "targetId": "configured-ai-search",
  "taskSummary": "Evaluate live retrieval for a configured AI Search source and verify whether the current MCP tool options still fail remotely.",
  "workflowType": "targeted",
  "recap": "remove-reranking-from-configured-search",
  "local": {
    "command": "nub run test:cloudflare",
    "status": "passed",
    "durationMs": 9200,
    "notes": [
      "Worker and MCP route passed with stubbed AI binding."
    ],
    "evidence": [
      "tests/integration/ai-search-mcp.test.ts local assertions passed."
    ]
  },
  "remote": {
    "command": "nub run test:cloudflare:remote",
    "status": "failed",
    "durationMs": 29910,
    "notes": [
      "Live aiSearch returned no documents for the semantic query."
    ],
    "evidence": [
      "aiSearch current MCP options returned dataCount 0",
      "rewrite-only and rerank-only variants returned documents"
    ]
  },
  "metrics": {
    "relevance": 4,
    "helpfulness": 4,
    "correctness": 5,
    "taskDurationMs": 39110
  },
  "metricDeltas": {
    "relevance": 1,
    "helpfulness": 1,
    "correctness": 0,
    "taskDurationMs": -4200
  },
  "baselineObservations": [
    "The remote harness isolates the failure to aiSearch option combinations instead of MCP wiring."
  ],
  "changesAttempted": [
    "Remove reranking while preserving rewrite_query."
  ],
  "worked": [
    "rewrite-only retrieval returned coordinator-related runbooks."
  ],
  "didntWork": [
    "rewrite plus reranking returned zero docs."
  ],
  "nextHypotheses": [
    "Ship rewrite-only defaults and re-run the remote suite."
  ],
  "webUpdates": [
    {
      "title": "Cloudflare AI Search docs update",
      "url": "https://developers.cloudflare.com/",
      "relevance": "Review for any changes to aiSearch rewrite or reranking semantics."
    }
  ],
  "rawEvidence": [
    "Remote AI Search comparison: aiSearch rewrite only returned dataCount 3."
  ],
  "existingHistoryReviewed": [
    "v001-bootstrap-agent-eval-workflow.md"
  ],
  "sourceCommands": [
    "nub run agent:eval:targets --target configured-ai-search",
    "nub run test:cloudflare",
    "nub run test:cloudflare:remote"
  ]
}
```

## Example Commands

Create a summary artifact:

```bash
cat <<'EOF' >/tmp/agent-eval-summary.json
{
  "targetId": "linea-coordinator-runbooks",
  "taskSummary": "Evaluate remote retrieval quality after a docs search change.",
  "workflowType": "targeted",
  "recap": "example-recap",
  "local": {
    "command": "nub run test:cloudflare",
    "status": "passed"
  },
  "remote": {
    "command": "nub run test:cloudflare:remote",
    "status": "failed"
  },
  "metrics": {
    "relevance": 4,
    "helpfulness": 4,
    "correctness": 5,
    "taskDurationMs": 12000
  }
}
EOF

nub run agent:eval:metrics --input /tmp/agent-eval-summary.json --output /tmp/agent-eval-summary.json
nub run agent:eval:note:write --input /tmp/agent-eval-summary.json --recap "example-recap"
```

## Note Writing Rules
- Keep notes factual and comparative.
- Prefer short bullets over long prose.
- Include both local and remote outcomes when both were run.
- If no improvement was attempted, say that explicitly instead of implying it.
