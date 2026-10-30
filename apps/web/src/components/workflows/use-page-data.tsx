import { useCallback, useEffect, useRef } from "react"
import { runApi } from "@/lib/api-client"
import { showErrorToast } from "@/lib/toast-manager"
import {
  upsertWorkflowSummary,
  WorkflowRun,
  WorkflowRunSnapshot,
  WorkflowRunTableState,
  WorkflowSummary,
} from "./types"
import { workflowListQueryParams, workflowRunQueryParams } from "./index-page"
import { migrateWorkflowManifestForBuilder, toCanvasEdge, toCanvasNode } from "./manifest-utils"
import { toWorkflowSummary } from "./api"
import { getErrorMessage } from "./run-utils"

export function useWorkflowPageData(input: any) {
  const {
    initialDetail,
    runFetchSequenceRef,
    runSelectionPinned,
    runSelectionPinnedRef,
    runTableState,
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
    workflowsLoadedRef,
  } = input

  const workflowFetchSequenceRef = useRef(0)
  const workflowDetailFetchSequenceRef = useRef(0)
  // The route loader already read the first list page and the workflow the URL opened.
  const skipInitialListLoadRef = useRef(true)
  const initialDetailRef = useRef<WorkflowSummary | null>(initialDetail)

  const applyWorkflow = useCallback(
    (workflow: WorkflowSummary) => {
      const manifest = workflow.manifest

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
      setWorkflows((current: WorkflowSummary[]) => upsertWorkflowSummary(current, workflow))
    },
    [
      setEdges,
      setNodes,
      setSelectedEdgeId,
      setWorkflowName,
      setWorkflows,
      setWorkflowHeaderDraftsByNode,
      setSelectedNodeId,
    ],
  )

  const loadWorkflows = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = workflowFetchSequenceRef.current + 1
      workflowFetchSequenceRef.current = sequence
      setLoading(true)

      try {
        const params = workflowListQueryParams(workflowListState)

        const data = await runApi(
          (client) => client.workflows.list({ query: Object.fromEntries(params) }),
          { signal },
        )

        if (workflowFetchSequenceRef.current !== sequence) {
          return
        }

        setWorkflows(data.workflows.map(toWorkflowSummary))
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
    [workflowListState, setWorkflowTotal, setWorkflows, workflowsLoadedRef, setLoading],
  )

  const loadWorkflow = useCallback(
    async (
      workflowId: string,
      options: {
        signal?: AbortSignal
        sequence: number
      },
    ) => {
      const data = await runApi((client) => client.workflows.get({ params: { id: workflowId } }), {
        signal: options.signal,
      })

      const workflow = toWorkflowSummary(data.workflow)

      if (options.signal?.aborted || workflowDetailFetchSequenceRef.current !== options.sequence) {
        return false
      }

      applyWorkflow(workflow)

      return true
    },
    [applyWorkflow],
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
        const data = await runApi(
          (client) =>
            client.workflows.runs({
              params: { id: workflowId },
              query: Object.fromEntries(params),
            }),
          { signal: options.signal },
        )

        if (options.signal?.aborted || runFetchSequenceRef.current !== sequence) {
          return
        }

        setRuns([...data.runs])
        setRunTableTotal(data.total)
        setRunTotal(data.totalRuns)
        setRunErrorsLast24Hours(data.errorsLast24Hours)
        setSelectedRunId((current: string | null) =>
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
    [
      runTableState,
      setRunTotal,
      setRunTableTotal,
      setRuns,
      runFetchSequenceRef,
      setSelectedRunId,
      setRunErrorsLast24Hours,
      setRunTableLoading,
    ],
  )

  const loadEvents = useCallback(
    async (workflowId: string, runId: string) => {
      const data = await runApi((client) =>
        client.workflows.runEvents({ params: { id: workflowId, runId } }),
      )

      setEvents([...data.events])
    },
    [setEvents],
  )

  const submitApproval = useCallback(
    async (runId: string, nodeId: string, approved: boolean) => {
      if (!selectedWorkflowId) {
        return
      }

      setSubmittingApprovalNodeId(nodeId)

      try {
        await runApi((client) =>
          client.workflows.approveRun({
            params: { id: selectedWorkflowId, runId },
            payload: { nodeId, approved },
          }),
        )
        await Promise.all([loadRuns(selectedWorkflowId), loadEvents(selectedWorkflowId, runId)])
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        setSubmittingApprovalNodeId(null)
      }
    },
    [loadEvents, loadRuns, selectedWorkflowId, setSubmittingApprovalNodeId],
  )

  useEffect(() => {
    if (skipInitialListLoadRef.current) {
      skipInitialListLoadRef.current = false

      return
    }

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

    const loadedWorkflow = initialDetailRef.current
    initialDetailRef.current = null

    if (loadedWorkflow && loadedWorkflow.id === selectedWorkflowId && loadedWorkflow.manifest) {
      applyWorkflow(loadedWorkflow)
      setWorkflowDetailLoadStateValue({ workflowId: selectedWorkflowId, phase: "ready" })

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
  }, [
    applyWorkflow,
    loadWorkflow,
    selectedWorkflowId,
    setWorkflowDetailLoadStateValue,
    workflowDetailReloadNonce,
    workflowDetailLoadStateRef,
  ])

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
  }, [loadRuns, selectedWorkflowId, setRunTableLoading])

  useEffect(() => {
    if (!selectedWorkflowId || !selectedRunId) {
      setEvents([])

      return
    }

    void loadEvents(selectedWorkflowId, selectedRunId)
  }, [loadEvents, selectedRunId, selectedWorkflowId, setEvents])

  useEffect(() => {
    if (!selectedWorkflowId) {
      return
    }

    const search =
      runSelectionPinned && selectedRunId ? `?runId=${encodeURIComponent(selectedRunId)}` : ""

    const source = new EventSource(`/api/workflows/${selectedWorkflowId}/events/stream${search}`)

    source.addEventListener("snapshot", (event) => {
      // SAFETY: The workflow snapshot listener receives a MessageEvent whose data is the WorkflowRunSnapshot JSON string.
      const snapshot = JSON.parse((event as MessageEvent<string>).data) as WorkflowRunSnapshot
      const snapshotRunsById = new Map(snapshot.runs.map((run) => [run.id, run]))
      setRuns((current: WorkflowRun[]) => current.map((run) => snapshotRunsById.get(run.id) ?? run))
      const nextRunId = runSelectionPinnedRef.current ? selectedRunIdRef.current : snapshot.runId
      setSelectedRunId((current: string | null) => {
        if (
          runSelectionPinnedRef.current &&
          current &&
          (snapshotRunsById.has(current) ||
            runsRef.current.some((run: WorkflowRun) => run.id === current))
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
  }, [
    runSelectionPinned,
    selectedRunId,
    selectedWorkflowId,
    runsRef,
    setRuns,
    setEvents,
    setSelectedRunId,
    selectedRunIdRef,
    runSelectionPinnedRef,
  ])

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
