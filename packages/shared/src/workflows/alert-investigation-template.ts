import { WORKFLOW_MANIFEST_VERSION, type WorkflowTemplate } from "./manifest-types"

function prompt(lines: string[]): string {
  return lines.join("\n")
}

function createAlertAgentOptions(promptText: string): Record<string, unknown> {
  return {
    model: "litellm/gpt-5.6-luna",
    reasoningEffort: "",
    prompt: promptText,
    sessionKey: "",
    cacheKey: "",
    cacheTtlSeconds: "",
    incognito: true,
    subagents: "enabled",
    tools: [],
    customMcpServers: {},
    secretKeys: [],
  }
}

const normalizeAlertPayloadCode = prompt([
  'const payload = inputs.payload && typeof inputs.payload === "object" ? inputs.payload : { value: inputs.payload };',
  'const alert = payload.alert && typeof payload.alert === "object" ? payload.alert : payload;',
  'const alertId = alert.alertId ?? alert.id ?? payload.alertId ?? payload.id ?? "";',
  'const alias = alert.alias ?? payload.alias ?? "";',
  "return {",
  '  alertId: String(alertId || ""),',
  '  alias: String(alias || ""),',
  '  message: String(alert.message ?? payload.message ?? ""),',
  '  priority: String(alert.priority ?? payload.priority ?? ""),',
  '  source: String(alert.source ?? payload.source ?? ""),',
  "  tags: Array.isArray(alert.tags) ? alert.tags : [],",
  "  raw: payload,",
  "};",
])

const orchestrateInvestigationPrompt = prompt([
  "You are the lead SRE investigator for an alert workflow. Investigate the alert and produce the final OpsGenie note.",
  "",
  "Delegate independent research to sub-agents when the configured tools and alert evidence make it useful. Parallelize non-overlapping work where possible. The useful investigation domains are:",
  "- Observability: logs, traces, metrics, dashboards, symptoms, and supported contributing factors",
  "- Similar OpsGenie alerts: active and recent matches, recurrence, duplication, and systematic patterns",
  "- Runbooks and documentation: applicable guidance, immediate verification or remediation steps, and caveats",
  "- FireHydrant incidents: related active or recent incidents, status, ownership, and coordination needs",
  "",
  "Give each sub-agent a focused task with the necessary alert context and require it to use relevant configured tools. Do not delegate a domain when it is irrelevant or no useful source is available. Reconcile contradictions between results. If material evidence is missing after the first results return, make targeted follow-up tool calls or delegate another focused task before drafting the note.",
  "Do not turn a tool-executable action into a recommended next step or gap. A missing discoverable selector, such as a Grafana organization or datasource ID, is new investigation context: retry with the strongest evidence-based candidate or delegate a focused follow-up using the discovered candidates.",
  "After the initial sub-agents return, explicitly review their results for unfinished read-only work. If any result supplies new selectors, likely candidates, query details, or another concrete investigation path, launch a distinct follow-up sub-agent with those exact findings before drafting.",
  "Finish only when a root cause is directly supported or every relevant configured read-only path has been attempted, including bounded candidate retries, and remaining gaps are genuine authorization, tool, or data limitations.",
  "",
  "Goals:",
  "- Decrease MTTR by giving SRE the fastest useful, evidence-backed diagnosis",
  "- Be maximally truthful and do not force a root cause that is not supported",
  "- Prefer brevity and make the point immediately",
  "- Make supporting evidence quick to scan",
  "",
  "Output format:",
  "SolZero alert investigation",
  "Summary: one or two direct sentences.",
  'Root cause: include the directly supported cause; otherwise write "not identified after exhausting available investigation paths".',
  "Evidence:",
  "- Compact bullets with the source area and confidence.",
  "Investigation limits:",
  "- Include only genuine authorization, unavailable-tool, or absent-data limitations that prevented further read-only investigation.",
  "",
  "Rules:",
  "- Do not invent logs, traces, metrics, dashboards, alerts, runbooks, incidents, or root causes.",
  "- Do not create or update incidents.",
  "- Preserve uncertainty and contradictions.",
  "- Avoid long background explanation.",
  "- Do not include a Recommended next steps section.",
  "- Do not recommend an investigation action that the configured tools could perform; perform it before answering.",
  "- State which tools or access are missing when a useful investigation domain could not be checked.",
  "- Keep list/search calls bounded: prefer count and exact-get tools, and request no more than 25 records per list call before narrowing further.",
  "",
  "Alert metadata:",
  "{{inputs.context}}",
])

export const ALERT_INVESTIGATION_TEMPLATE = {
  id: "alert-investigation",
  name: "Alert investigation workflow",
  description:
    "Orchestrate alert research with sub-agents and post an evidence-backed OpsGenie note.",
  complexity: "moderate",
  tags: ["webhook", "sre", "opsgenie", "incident"],
  manifest: {
    version: WORKFLOW_MANIFEST_VERSION,
    name: "Alert investigation workflow",
    nodes: [
      {
        id: "webhook",
        type: "webhook-trigger",
        label: "Alert webhook",
        position: { x: -80, y: 312 },
        options: {},
      },
      {
        id: "normalize",
        type: "javascript",
        label: "Normalize alert payload",
        position: { x: 220, y: 312 },
        options: {
          code: normalizeAlertPayloadCode,
        },
      },
      {
        id: "investigate_and_draft_note",
        type: "isolate-session",
        label: "Investigate and draft note",
        position: { x: 540, y: 212 },
        options: createAlertAgentOptions(orchestrateInvestigationPrompt),
      },
      {
        id: "opsgenie_note_payload",
        type: "json-object",
        label: "OpsGenie note payload",
        position: { x: 884, y: 312 },
        options: {
          fields: ["alert", "note"],
        },
      },
      {
        id: "post_opsgenie_note",
        type: "http-request",
        label: "Post OpsGenie note",
        position: { x: 1224, y: 312 },
        options: {
          method: "POST",
          url: "https://api.opsgenie.com/v2/alerts/{{inputs.body.alert.alertId}}/notes",
          headers: {
            Authorization: "GenieKey replace-with-opsgenie-api-key",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: '{"note":"{{inputs.body.note}}"}',
          responseType: "auto",
          timeoutMs: 30000,
          failOnHttpError: false,
        },
      },
    ],
    edges: [
      {
        id: "webhook-body-normalize",
        source: "webhook",
        target: "normalize",
        sourceHandle: "body",
        targetHandle: "payload",
      },
      {
        id: "normalize-investigate",
        source: "normalize",
        target: "investigate_and_draft_note",
        sourceHandle: "result",
        targetHandle: "context",
      },
      {
        id: "normalize-note-payload-alert",
        source: "normalize",
        target: "opsgenie_note_payload",
        sourceHandle: "result",
        targetHandle: "alert",
      },
      {
        id: "investigation-note-payload-note",
        source: "investigate_and_draft_note",
        target: "opsgenie_note_payload",
        sourceHandle: "output",
        targetHandle: "note",
      },
      {
        id: "note-payload-post",
        source: "opsgenie_note_payload",
        target: "post_opsgenie_note",
        sourceHandle: "object",
        targetHandle: "body",
      },
    ],
  },
} satisfies WorkflowTemplate
