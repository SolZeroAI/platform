import type { AdminWorkflowRecord } from "@c0/api"

export async function runSessionAction(
  id: string,
  action: "stop" | "archive" | "unarchive" | "delete",
) {
  const reason = action === "stop" ? "" : requestReason(`${action} session ${id}`)
  if (reason === null) {
    return
  }
  const init: RequestInit = {
    method: action === "delete" ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  }
  await requestJson(`/api/admin/sessions/${id}${action === "delete" ? "" : `/${action}`}`, init)
}

export async function runWorkflowAction(
  workflow: AdminWorkflowRecord,
  action: "run" | "archive" | "unarchive",
) {
  const reason = requestReason(`${action} workflow ${workflow.id}`)
  if (reason === null) {
    return
  }
  const path =
    action === "run"
      ? `/api/admin/workflows/${workflow.id}/runs`
      : `/api/admin/workflows/${workflow.id}${action === "unarchive" ? "/unarchive" : ""}`
  const method = action === "archive" ? "DELETE" : "POST"
  await requestJson(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
}

export async function retryWorkflowRun(workflowId: string, runId: string) {
  const reason = requestReason(`retry workflow run ${runId}`)
  if (reason === null) {
    return
  }
  await requestJson(`/api/admin/workflows/${workflowId}/runs/${runId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
}

export async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string
    message?: string
  }
  if (!response.ok) {
    throw new Error(data.error ?? data.message ?? `Request failed with status ${response.status}`)
  }
  return data
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestReason(label: string): string | null {
  if (!window.confirm(`Confirm ${label}?`)) {
    return null
  }
  const reason = window.prompt("Reason")
  if (!reason?.trim()) {
    return null
  }
  return reason.trim()
}
