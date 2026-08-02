// @ts-nocheck
import { useBlocker } from "@tanstack/react-router"
import { useCallback } from "react"
import {
  parseWorkflowExport,
  validateWorkflowDraft,
  type WorkflowManifest,
  type WorkflowManifestNode,
  type WorkflowTemplate,
} from "@c0-agent/shared"
import { showErrorToast } from "@/lib/toast-manager"
import {
  RunTriggerOptions,
  TriggerRunRequest,
  upsertWorkflowSummary,
  WorkflowCreationMode,
  WorkflowRun,
  WorkflowSaveDialogSummary,
  WorkflowSaveResponse,
  WorkflowSaveRevertAction,
  WorkflowSummary,
} from "./types"
import { migrateWorkflowManifestForBuilder, toCanvasEdge, toCanvasNode } from "./manifest-utils"
import {
  applyWorkflowSaveRevertAction,
  getWorkflowRuntimeVersionChangePreview,
  getWorkflowSaveChangeSummary,
  getWorkflowVersionSaveLabel,
  stripWorkflowSaveChangeRevertActions,
} from "./save-utils"
import { downloadTextFile, getErrorMessage, requestJson } from "./run-utils"
import { formatJson } from "./header-utils"

export function useWorkflowPageActions(input: any) {
  const {
    builderPrompt,
    currentManifest,
    edges,
    emptyStarterVisible,
    loadRuns,
    loadWorkflowDraft,
    navigationBypassRef,
    nodes,
    resetWorkflowDraft,
    running,
    runs,
    runsRef,
    saving,
    selectWorkflow,
    selectedRunIdRef,
    selectedWorkflow,
    selectedWorkflowId,
    setActiveTab,
    setBuilderRunning,
    setCreationDialogOpen,
    setCreationMode,
    setDeletingRunId,
    setDeletingWorkflowId,
    setEdges,
    setEmptyStarterVisible,
    setEvents,
    setImportWarnings,
    setNodes,
    setRunDetailsOpen,
    setRunPendingDeletion,
    setRunSelectionPinned,
    setRunTableTotal,
    setRunTotal,
    setRunning,
    setRuns,
    setSaving,
    setSavingBeforeNavigation,
    setSavingWorkflowTitle,
    setSelectedEdgeId,
    setSelectedNodeId,
    setSelectedRunId,
    setSelectedWorkflowId,
    setSlackTestNode,
    setUpdatingWorkflowStatus,
    setWebhookTestNode,
    setWorkflowDetailLoadStateValue,
    setWorkflowHeaderDraftsByNode,
    setWorkflowName,
    setWorkflowTitleDraft,
    setWorkflowPendingDeletion,
    setWorkflowSaveDialog,
    setWorkflowTotal,
    setWorkflowValidationDialogOpen,
    setWorkflows,
    showWorkflowIndexView,
    showWorkflowRoute,
    startWorkflowAiTurn,
    workflowConfigErrors,
    workflowDirty,
    workflowDisabled,
    workflowHasSaveDiff,
    workflowName,
    workflowTitleDraft,
    workflowSaveDialog,
    workflows,
  } = input

  const persistWorkflowSave = useCallback(async (): Promise<WorkflowSaveResponse> => {
    const endpoint = selectedWorkflowId ? `/api/workflows/${selectedWorkflowId}` : "/api/workflows"
    const method = selectedWorkflowId ? "PUT" : "POST"
    return requestJson<WorkflowSaveResponse>(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: selectedWorkflow?.name ?? workflowName,
        manifest: currentManifest,
      }),
    })
  }, [currentManifest, selectedWorkflow?.name, selectedWorkflowId, workflowName])

  const applyWorkflowSave = useCallback(
    (data: WorkflowSaveResponse, options: { updateRoute?: boolean } = {}) => {
      const workflowAlreadyListed = workflows.some((workflow) => workflow.id === data.workflow.id)
      setSelectedWorkflowId(data.workflow.id)
      setWorkflowDetailLoadStateValue({ workflowId: data.workflow.id, phase: "ready" })
      setEmptyStarterVisible(false)
      if ((options.updateRoute ?? true) && data.workflow.id !== selectedWorkflowId) {
        navigationBypassRef.current = true
        showWorkflowRoute(data.workflow.id, !selectedWorkflowId)
      }
      setWorkflows((current) => upsertWorkflowSummary(current, data.workflow))
      if (!workflowAlreadyListed) {
        setWorkflowTotal((current) => current + 1)
      }
    },
    [selectedWorkflowId, setWorkflowDetailLoadStateValue, showWorkflowRoute, workflows],
  )

  const getWorkflowSaveDialogSummaryForManifest = useCallback(
    (manifest: WorkflowManifest): WorkflowSaveDialogSummary => {
      const previousManifest = selectedWorkflow?.manifest ?? null
      const runtimeVersionChange = getWorkflowRuntimeVersionChangePreview(
        previousManifest,
        manifest,
      )
      const migratedPreviousManifest =
        previousManifest && runtimeVersionChange
          ? migrateWorkflowManifestForBuilder(previousManifest)
          : previousManifest

      return {
        changes: getWorkflowSaveChangeSummary(migratedPreviousManifest, manifest, {
          includeFallback: !runtimeVersionChange,
        }),
        systemChanges:
          previousManifest && migratedPreviousManifest && runtimeVersionChange
            ? stripWorkflowSaveChangeRevertActions(
                getWorkflowSaveChangeSummary(previousManifest, migratedPreviousManifest, {
                  includeFallback: false,
                }),
              )
            : [],
        workflowVersion: getWorkflowVersionSaveLabel(selectedWorkflow),
        runtimeVersionChange,
      }
    },
    [selectedWorkflow],
  )

  const getCurrentWorkflowSaveDialogSummary = useCallback(
    (): WorkflowSaveDialogSummary => getWorkflowSaveDialogSummaryForManifest(currentManifest),
    [currentManifest, getWorkflowSaveDialogSummaryForManifest],
  )

  const hasWorkflowSaveDiffForManifest = useCallback(
    (manifest: WorkflowManifest): boolean => {
      if (!selectedWorkflowId) {
        return !emptyStarterVisible
      }
      return selectedWorkflow?.manifest
        ? formatJson(manifest) !== formatJson(selectedWorkflow.manifest)
        : false
    },
    [emptyStarterVisible, selectedWorkflow?.manifest, selectedWorkflowId],
  )

  const revertWorkflowSaveDialogChange = useCallback(
    (action: WorkflowSaveRevertAction) => {
      const nextManifest = applyWorkflowSaveRevertAction(currentManifest, action)
      const nextNodeIds = new Set(nextManifest.nodes.map((node) => node.id))
      const nextEdgeIds = new Set(nextManifest.edges.map((edge) => edge.id))

      setWorkflowName(nextManifest.name)
      setNodes(nextManifest.nodes.map(toCanvasNode))
      setEdges(nextManifest.edges.map(toCanvasEdge))
      setSelectedNodeId((current) =>
        current && nextNodeIds.has(current) ? current : (nextManifest.nodes[0]?.id ?? null),
      )
      setSelectedEdgeId((current) => (current && nextEdgeIds.has(current) ? current : null))
      setWorkflowHeaderDraftsByNode((current) => {
        const next = Object.fromEntries(
          Object.entries(current).filter(([nodeId]) => nextNodeIds.has(nodeId)),
        )
        return Object.keys(next).length === Object.keys(current).length ? current : next
      })
      setWorkflowSaveDialog((current) => {
        if (!current || current.phase === "saving") {
          return current
        }
        if (!hasWorkflowSaveDiffForManifest(nextManifest)) {
          return null
        }
        return {
          ...current,
          summary: getWorkflowSaveDialogSummaryForManifest(nextManifest),
        }
      })
    },
    [
      currentManifest,
      getWorkflowSaveDialogSummaryForManifest,
      hasWorkflowSaveDiffForManifest,
      setEdges,
      setNodes,
    ],
  )

  const saveWorkflow = useCallback(
    async (options: { updateRoute?: boolean } = {}): Promise<boolean> => {
      if (workflowConfigErrors.length > 0) {
        setWorkflowValidationDialogOpen(true)
        return false
      }

      setSaving(true)
      try {
        applyWorkflowSave(await persistWorkflowSave(), options)
        return true
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
        return false
      } finally {
        setSaving(false)
      }
    },
    [applyWorkflowSave, persistWorkflowSave, workflowConfigErrors.length],
  )

  const saveWorkflowTitle = useCallback(async (): Promise<boolean> => {
    const name = workflowTitleDraft.trim()
    if (!selectedWorkflowId || !selectedWorkflow || !name) {
      return false
    }

    setSavingWorkflowTitle(true)
    try {
      const data = await requestJson<{ workflow: WorkflowSummary }>(
        `/api/workflows/${selectedWorkflowId}/name`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      )
      const workflow = {
        ...data.workflow,
        manifest: data.workflow.manifest ?? selectedWorkflow.manifest,
      }
      setWorkflows((current) => upsertWorkflowSummary(current, workflow))
      setWorkflowTitleDraft(workflow.name)
      return true
    } catch (errorValue) {
      showErrorToast(getErrorMessage(errorValue))
      return false
    } finally {
      setSavingWorkflowTitle(false)
    }
  }, [
    selectedWorkflow,
    selectedWorkflowId,
    setSavingWorkflowTitle,
    setWorkflowTitleDraft,
    setWorkflows,
    workflowTitleDraft,
  ])

  const openWorkflowSaveDialog = useCallback(() => {
    if (workflowConfigErrors.length > 0) {
      setWorkflowValidationDialogOpen(true)
      return
    }
    if (!workflowHasSaveDiff) {
      return
    }
    setWorkflowSaveDialog({
      phase: "confirm",
      summary: getCurrentWorkflowSaveDialogSummary(),
    })
  }, [getCurrentWorkflowSaveDialogSummary, workflowConfigErrors.length, workflowHasSaveDiff])

  const confirmWorkflowSave = useCallback(async () => {
    if (!workflowSaveDialog) {
      return
    }
    const summary = workflowSaveDialog.summary
    setSaving(true)
    setWorkflowSaveDialog({ phase: "saving", summary })
    try {
      const data = await persistWorkflowSave()
      applyWorkflowSave(data)
      setWorkflowSaveDialog(null)
    } catch (errorValue) {
      setWorkflowSaveDialog({
        phase: "failure",
        summary,
        error: getErrorMessage(errorValue),
      })
    } finally {
      setSaving(false)
    }
  }, [applyWorkflowSave, persistWorkflowSave, workflowSaveDialog])

  const closeWorkflowSaveDialog = useCallback(() => {
    if (workflowSaveDialog?.phase === "saving") {
      return
    }
    setWorkflowSaveDialog(null)
  }, [workflowSaveDialog?.phase])

  const shouldBlockWorkflowNavigation = useCallback(() => {
    if (navigationBypassRef.current) {
      navigationBypassRef.current = false
      return false
    }
    return !showWorkflowIndexView && workflowDirty
  }, [showWorkflowIndexView, workflowDirty])

  const navigationBlocker = useBlocker({
    shouldBlockFn: shouldBlockWorkflowNavigation,
    enableBeforeUnload: () => !showWorkflowIndexView && workflowDirty,
    withResolver: true,
  })

  const saveBeforeNavigation = useCallback(async () => {
    if (navigationBlocker.status !== "blocked") {
      return
    }

    setSavingBeforeNavigation(true)
    try {
      const saved = await saveWorkflow({ updateRoute: false })
      if (saved) {
        navigationBlocker.proceed()
      }
    } finally {
      setSavingBeforeNavigation(false)
    }
  }, [navigationBlocker, saveWorkflow])

  const deleteWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      setDeletingWorkflowId(workflow.id)
      try {
        await requestJson<{ status: string; workflowId: string }>(`/api/workflows/${workflow.id}`, {
          method: "DELETE",
        })
        const remaining = workflows.filter((item) => item.id !== workflow.id)
        setWorkflows(remaining)
        setWorkflowTotal((current) => Math.max(0, current - 1))
        setWorkflowPendingDeletion(null)
        if (selectedWorkflowId === workflow.id) {
          const deletedIndex = workflows.findIndex((item) => item.id === workflow.id)
          const nextWorkflow = remaining[Math.max(0, deletedIndex)] ?? remaining[0] ?? null
          if (nextWorkflow) {
            selectWorkflow(nextWorkflow.id)
          } else {
            resetWorkflowDraft("builder")
          }
        }
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        setDeletingWorkflowId((current) => (current === workflow.id ? null : current))
      }
    },
    [resetWorkflowDraft, selectWorkflow, selectedWorkflowId, workflows],
  )

  const deleteWorkflowRun = useCallback(
    async (run: WorkflowRun) => {
      if (!selectedWorkflowId) {
        return
      }

      setDeletingRunId(run.id)
      try {
        await requestJson<{ status: string; workflowId: string; runId: string }>(
          `/api/workflows/${selectedWorkflowId}/runs/${run.id}`,
          { method: "DELETE" },
        )
        const nextRuns = runsRef.current.filter((item) => item.id !== run.id)
        setRuns(nextRuns)
        setRunTableTotal((current) => Math.max(0, current - 1))
        setRunTotal((current) => Math.max(0, current - 1))
        setRunPendingDeletion(null)
        if (selectedRunIdRef.current === run.id) {
          setSelectedRunId(nextRuns[0]?.id ?? null)
          setRunSelectionPinned(false)
          setRunDetailsOpen(false)
          setEvents([])
        }
        await loadRuns(selectedWorkflowId)
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        setDeletingRunId((current) => (current === run.id ? null : current))
      }
    },
    [loadRuns, selectedWorkflowId],
  )

  const setWorkflowEnabled = useCallback(async (workflow: WorkflowSummary, enabled: boolean) => {
    setUpdatingWorkflowStatus(true)
    try {
      const action = enabled ? "enable" : "disable"
      const data = await requestJson<{ workflow: WorkflowSummary }>(
        `/api/workflows/${workflow.id}/${action}`,
        {
          method: "POST",
        },
      )
      setWorkflows((current) => upsertWorkflowSummary(current, data.workflow))
    } catch (errorValue) {
      showErrorToast(getErrorMessage(errorValue))
    } finally {
      setUpdatingWorkflowStatus(false)
    }
  }, [])

  const runTrigger = useCallback(
    async (trigger: TriggerRunRequest, options: RunTriggerOptions = {}) => {
      if (!selectedWorkflowId) {
        const message = "Save the workflow before testing a trigger."
        showErrorToast(message)
        if (options.throwOnError) {
          throw new Error(message)
        }
        return
      }
      if (workflowDisabled) {
        const message = "Enable the workflow before running a trigger."
        showErrorToast(message)
        if (options.throwOnError) {
          throw new Error(message)
        }
        return
      }
      setRunning(true)
      try {
        const data = await requestJson<{ run: WorkflowRun }>(
          `/api/workflows/${selectedWorkflowId}/runs`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trigger }),
          },
        )
        setRuns((current) => [data.run, ...current.filter((run) => run.id !== data.run.id)])
        setRunTableTotal((current) => current + 1)
        setRunTotal((current) => current + 1)
        setSelectedRunId(data.run.id)
        setRunSelectionPinned(false)
        setRunDetailsOpen(true)
        setActiveTab("overview")
        await loadRuns(selectedWorkflowId)
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
        if (options.throwOnError) {
          throw errorValue
        }
      } finally {
        setRunning(false)
      }
    },
    [loadRuns, selectedWorkflowId, workflowDisabled],
  )

  const testTriggerNode = useCallback(
    (node: WorkflowManifestNode) => {
      if (node.type === "webhook-trigger") {
        setWebhookTestNode(node)
        return
      }
      if (node.type === "slack-trigger") {
        setSlackTestNode(node)
        return
      }
      if (node.type === "manual-trigger") {
        void runTrigger({
          kind: "manual",
          nodeId: node.id,
          payload: {},
        })
        return
      }
      if (node.type === "datetime-trigger") {
        void runTrigger({
          kind: "datetime",
          nodeId: node.id,
          scheduledAt:
            typeof node.options.scheduledAt === "string" ? node.options.scheduledAt : null,
          firedAt: new Date().toISOString(),
          payload: {},
        })
        return
      }
      if (node.type === "cron-trigger") {
        void runTrigger({
          kind: "cron",
          nodeId: node.id,
          cron: typeof node.options.cron === "string" ? node.options.cron : null,
          scheduledAt: new Date().toISOString(),
          firedAt: new Date().toISOString(),
          payload: {},
        })
      }
    },
    [runTrigger, setSlackTestNode, setWebhookTestNode],
  )

  const openWorkflowCreationMode = useCallback((mode: WorkflowCreationMode) => {
    setCreationMode(mode)
    setImportWarnings([])
    setCreationDialogOpen(true)
  }, [])

  const createDraftFromTemplate = useCallback(
    (template: WorkflowTemplate) => {
      loadWorkflowDraft(structuredClone(template.manifest))
    },
    [loadWorkflowDraft],
  )

  const importWorkflowFile = useCallback(
    async (file: File) => {
      setImportWarnings([])
      try {
        const text = await file.text()
        const exported = parseWorkflowExport(text)
        const validation = validateWorkflowDraft(exported.manifest)
        if (!validation.valid || !validation.manifest) {
          throw new Error(validation.errors[0] ?? "Invalid workflow export")
        }
        loadWorkflowDraft(validation.manifest, validation.warnings)
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      }
    },
    [loadWorkflowDraft],
  )

  const exportSelectedWorkflow = useCallback(async () => {
    if (!selectedWorkflowId) {
      return
    }
    try {
      const response = await fetch(`/api/workflows/${selectedWorkflowId}/export`)
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Export failed with status ${response.status}`)
      }
      const yaml = await response.text()
      downloadTextFile(`${selectedWorkflow?.name ?? selectedWorkflowId}.workflow.yaml`, yaml)
    } catch (errorValue) {
      showErrorToast(getErrorMessage(errorValue))
    }
  }, [selectedWorkflow?.name, selectedWorkflowId])

  const buildWorkflowWithLlm = useCallback(async () => {
    setBuilderRunning(true)
    try {
      await startWorkflowAiTurn({ prompt: builderPrompt, mode: "build" })
    } finally {
      setBuilderRunning(false)
    }
  }, [builderPrompt, startWorkflowAiTurn])

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId)
    setRunSelectionPinned(true)
    setRunDetailsOpen(true)
  }, [])

  return {
    applyWorkflowSave,
    buildWorkflowWithLlm,
    closeWorkflowSaveDialog,
    confirmWorkflowSave,
    createDraftFromTemplate,
    deleteWorkflow,
    deleteWorkflowRun,
    exportSelectedWorkflow,
    getCurrentWorkflowSaveDialogSummary,
    getWorkflowSaveDialogSummaryForManifest,
    hasWorkflowSaveDiffForManifest,
    importWorkflowFile,
    navigationBlocker,
    openWorkflowCreationMode,
    openWorkflowSaveDialog,
    persistWorkflowSave,
    revertWorkflowSaveDialogChange,
    runTrigger,
    saveBeforeNavigation,
    saveWorkflow,
    saveWorkflowTitle,
    selectRun,
    setWorkflowEnabled,
    shouldBlockWorkflowNavigation,
    testTriggerNode,
  }
}
