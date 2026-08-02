// @ts-nocheck
import { useCallback, useEffect, useRef } from "react"
import { showErrorToast } from "@/lib/toast-manager"
import {
  upsertWorkflowSummary,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowRunTableState,
  WorkflowSummary,
} from "./types"
import { workflowListQueryParams, workflowRunQueryParams } from "./index-page"
import { migrateWorkflowManifestForBuilder, toCanvasEdge, toCanvasNode } from "./manifest-utils"
import { getErrorMessage, requestJson } from "./run-utils"

export function useWorkflowPageData(input: any) {
  const {
    edges,
    events,
    loading,
    nodes,
    runFetchSequenceRef,
    runSelectionPinned,
    runSelectionPinnedRef,
    runTableState,
    runs,
    runsRef,
    selectedRunId,
    selectedRunIdRef,
    selectedWorkflowId,
    setEdges,
    setEvents,
    setLoading,
    setNodes,
    setRunErrorsLast24Hours,
    setRunTableLoading,
    setRunTableTotal,
    setRunTotal,
    setRuns,
    setSelectedEdgeId,
    setSelectedNodeId,
    setSelectedRunId,
    setSubmittingApprovalNodeId,
    setWorkflowDetailLoadStateValue,
    setWorkflowHeaderDraftsByNode,
    setWorkflowName,
    setWorkflowTotal,
    setWorkflows,
    workflowDetailLoadStateRef,
    workflowDetailReloadNonce,
    workflowListState,
    workflows,
    workflowsLoadedRef,
  } = input

  const workflowFetchSequenceRef = useRef(0)
  const workflowDetailFetchSequenceRef = useRef(0)

  const loadWorkflows = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = workflowFetchSequenceRef.current + 1
      workflowFetchSequenceRef.current = sequence
      setLoading(true)
      try {
        const params = workflowListQueryParams(workflowListState)
        const data = await requestJson<{
          workflows: WorkflowSummary[]
          total: number
          limit: number
          offset: number
          hasMore: boolean
        }>(`/api/workflows?${params.toString()}`, { signal })
        if (workflowFetchSequenceRef.current !== sequence) {
          return
        }
        setWorkflows(data.workflows)
        setWorkflowTotal(data.total)
        workflowsLoadedRef.current = true
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        if (workflowFetchSequenceRef.current === sequence) {
          setLoading(false)
        }
      }
    },
    [workflowListState],
  )

  const loadWorkflow = useCallback(
    async (
      workflowId: string,
      options: {
        signal?: AbortSignal
        sequence: number
      },
    ) => {
      const data = await requestJson<{ workflow: WorkflowSummary }>(
        `/api/workflows/${workflowId}`,
        {
          signal: options.signal,
        },
      )
      if (options.signal?.aborted || workflowDetailFetchSequenceRef.current !== options.sequence) {
        return false
      }
      const manifest = data.workflow.manifest
      if (!manifest) {
        throw new Error("Workflow response did not include a manifest")
      }
      const builderManifest = migrateWorkflowManifestForBuilder(manifest)
      setWorkflowName(builderManifest.name)
      setNodes(builderManifest.nodes.map(toCanvasNode))
      setEdges(builderManifest.edges.map(toCanvasEdge))
      setSelectedNodeId(builderManifest.nodes[0]?.id ?? null)
      setSelectedEdgeId(null)
      setWorkflowHeaderDraftsByNode({})
      setWorkflows((current) => upsertWorkflowSummary(current, data.workflow))
      return true
    },
    [setEdges, setNodes],
  )

  const loadRuns = useCallback(
    async (
      workflowId: string,
      options: { signal?: AbortSignal; state?: WorkflowRunTableState } = {},
    ) => {
      const sequence = runFetchSequenceRef.current + 1
      runFetchSequenceRef.current = sequence
      const state = options.state ?? runTableState
      const params = workflowRunQueryParams(state)
      setRunTableLoading(true)
      try {
        const data = await requestJson<{
          runs: WorkflowRun[]
          total: number
          totalRuns: number
          errorsLast24Hours: number
          limit: number
          offset: number
          hasMore: boolean
        }>(`/api/workflows/${workflowId}/runs?${params.toString()}`, {
          signal: options.signal,
        })
        if (options.signal?.aborted || runFetchSequenceRef.current !== sequence) {
          return
        }
        setRuns(data.runs)
        setRunTableTotal(data.total)
        setRunTotal(data.totalRuns)
        setRunErrorsLast24Hours(data.errorsLast24Hours)
        setSelectedRunId((current) =>
          current && data.runs.some((run) => run.id === current)
            ? current
            : (data.runs[0]?.id ?? null),
        )
      } catch (errorValue) {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        if (runFetchSequenceRef.current === sequence) {
          setRunTableLoading(false)
        }
      }
    },
    [runTableState],
  )

  const loadEvents = useCallback(async (workflowId: string, runId: string) => {
    const data = await requestJson<{ events: WorkflowRunEvent[] }>(
      `/api/workflows/${workflowId}/runs/${runId}/events`,
    )
    setEvents(data.events)
  }, [])

  const submitApproval = useCallback(
    async (runId: string, nodeId: string, approved: boolean) => {
      if (!selectedWorkflowId) {
        return
      }

      setSubmittingApprovalNodeId(nodeId)
      try {
        await requestJson(`/api/workflows/${selectedWorkflowId}/runs/${runId}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId, approved }),
        })
        await Promise.all([loadRuns(selectedWorkflowId), loadEvents(selectedWorkflowId, runId)])
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        setSubmittingApprovalNodeId(null)
      }
    },
    [loadEvents, loadRuns, selectedWorkflowId],
  )

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      void loadWorkflows(controller.signal)
    }, 200)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [loadWorkflows])

  useEffect(() => {
    if (!selectedWorkflowId) {
      setWorkflowDetailLoadStateValue(null)
      return
    }
    const currentDetailLoadState = workflowDetailLoadStateRef.current
    if (
      currentDetailLoadState?.workflowId === selectedWorkflowId &&
      currentDetailLoadState.phase === "ready"
    ) {
      return
    }
    const sequence = workflowDetailFetchSequenceRef.current + 1
    workflowDetailFetchSequenceRef.current = sequence
    const controller = new AbortController()
    setWorkflowDetailLoadStateValue({ workflowId: selectedWorkflowId, phase: "loading" })
    void loadWorkflow(selectedWorkflowId, { signal: controller.signal, sequence })
      .then((applied) => {
        if (!applied || workflowDetailFetchSequenceRef.current !== sequence) {
          return
        }
        setWorkflowDetailLoadStateValue({ workflowId: selectedWorkflowId, phase: "ready" })
      })
      .catch((errorValue) => {
        if (errorValue instanceof Error && errorValue.name === "AbortError") {
          return
        }
        if (workflowDetailFetchSequenceRef.current !== sequence) {
          return
        }
        const message = getErrorMessage(errorValue)
        setWorkflowDetailLoadStateValue({ workflowId: selectedWorkflowId, phase: "error", message })
        showErrorToast(message)
      })
    return () => {
      controller.abort()
    }
  }, [loadWorkflow, selectedWorkflowId, setWorkflowDetailLoadStateValue, workflowDetailReloadNonce])

  useEffect(() => {
    if (!selectedWorkflowId) {
      setRunTableLoading(false)
      return
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      void loadRuns(selectedWorkflowId, { signal: controller.signal })
    }, 200)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [loadRuns, selectedWorkflowId])

  useEffect(() => {
    if (!selectedWorkflowId || !selectedRunId) {
      setEvents([])
      return
    }
    void loadEvents(selectedWorkflowId, selectedRunId)
  }, [loadEvents, selectedRunId, selectedWorkflowId])

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }
    const search =
      runSelectionPinned && selectedRunId ? `?runId=${encodeURIComponent(selectedRunId)}` : ""
    const source = new EventSource(`/api/workflows/${selectedWorkflowId}/events/stream${search}`)

    source.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as WorkflowRunSnapshot
      const snapshotRunsById = new Map(snapshot.runs.map((run) => [run.id, run]))
      setRuns((current) => current.map((run) => snapshotRunsById.get(run.id) ?? run))
      const nextRunId = runSelectionPinnedRef.current ? selectedRunIdRef.current : snapshot.runId
      setSelectedRunId((current) => {
        if (
          runSelectionPinnedRef.current &&
          current &&
          (snapshotRunsById.has(current) || runsRef.current.some((run) => run.id === current))
        ) {
          return current
        }
        return nextRunId
      })
      if (nextRunId === snapshot.runId) {
        setEvents(snapshot.events)
      }
    })

    return () => {
      source.close()
    }
  }, [runSelectionPinned, selectedRunId, selectedWorkflowId])

  return {
    loadEvents,
    loadRuns,
    loadWorkflow,
    loadWorkflows,
    submitApproval,
    workflowDetailFetchSequenceRef,
    workflowFetchSequenceRef,
  }
}
