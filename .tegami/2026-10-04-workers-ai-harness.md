---
packages:
  "release:solzero": patch
---

## Run OpenCode and Codex with Cloudflare GPT-OSS

OpenCode and Codex can now complete prompts, execute shell tools, and continue sessions with the configured Cloudflare GPT-OSS model. SolZero bridges buffered native Chat output to the Responses stream required by the harnesses, preserving actual text, tool calls, and results. Output is delivered after the provider finishes generating it.
