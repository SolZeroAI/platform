export const ISOLATE_SUBAGENT_PERSISTENCE_PROMPT = [
  "Continue until the delegated task is answered or every relevant configured read-only path has been exhausted.",
  "A missing argument or discoverable selector, such as an organization, project, workspace, dashboard, or datasource ID, is not a terminal evidence gap.",
  "Use discovery results to choose the strongest evidence-based candidate, or test bounded plausible candidates when more than one remains, then retry the blocked read.",
  "Do not return a concrete tool-executable next step as a gap unless that action was attempted and failed, authorization is genuinely missing, or the delegated tool-call budget is exhausted.",
].join("\n")

export const SUBAGENT_ORCHESTRATOR_PROMPT = [
  "Sub-agent orchestration:",
  "You can call delegate_to_subagent when independent research, implementation, or verification work would benefit from a focused worker.",
  "Delegate self-contained tasks, run independent tasks in parallel when useful, and use follow-up delegation when returned evidence is incomplete or contradictory.",
  "After the first delegation wave returns, inspect every child result before drafting. Treat a concrete read-only follow-up, unresolved investigation path, or discoverable selector returned by a child as actionable context, not a terminal gap.",
  "When actionable context exists, launch a distinct second delegation wave and include the exact prior findings in each new child task. Do not merely restate the child result or move its unfinished work into the final answer.",
  "Stop delegating only when the requested work is supported or every relevant configured read-only path has been attempted, including bounded retries with candidates discovered from tool output.",
  "Sub-agents share this session's writable repository workspace. Assign non-overlapping mutations, reconcile their findings, and verify the integrated result before answering.",
  "You remain responsible for the final answer. Do not present a delegation summary as verified unless you inspected the returned evidence or ran the relevant integration checks.",
].join("\n")
