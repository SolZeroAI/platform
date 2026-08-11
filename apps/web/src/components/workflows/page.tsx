import {
  addEdge,
  type Connection,
  type OnEdgesChange,
  useEdgesState,
  useNodesState,
} from "@xyflow/react"
import { useBlocker, useNavigate } from "@tanstack/react-router"
import { Save } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  getWorkflowNodeDefaultOptions,
  getWorkflowNodeDefinition,
  getWorkflowNodeDefinitionForNode,
  parseWorkflowExport,
  validateWorkflowDraft,
  type ProviderSettingsResponse,
  type WorkflowManifest,
  type WorkflowManifestNode,
  type WorkflowNodeType,
  type WorkflowTemplate,
} from "@solzero/shared"
import { PageHeader } from "@/components/page-header"
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal"
import { SidebarLayout } from "@/components/sidebar-layout"
import { useProviderSettings } from "@/hooks/use-provider-settings"
import { copyToClipboard } from "@/lib/format"
import { showErrorToast } from "@/lib/toast-manager"
import {
  getWorkflowNodeConfigErrorDetails,
  getWorkflowNodeConfigErrorsByNode,
  PendingConnectionReplacement,
  PendingManualInputOverwrite,
  RunTriggerOptions,
  TriggerRunRequest,
  upsertWorkflowSummary,
  WORKFLOW_DEFAULT_TABLE_STATE,
  WORKFLOW_RUN_DEFAULT_TABLE_STATE,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowConfigFocusTarget,
  WorkflowCreationMode,
  WorkflowDetailLoadState,
  WorkflowHeaderDraftRow,
  WorkflowListTableState,
  WorkflowNodeConfigErrorDetails,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowRunTableState,
  WorkflowSaveDialogState,
  WorkflowSaveDialogSummary,
  WorkflowSaveResponse,
  WorkflowSaveRevertAction,
  WorkflowSummary,
  WorkflowViewTab,
} from "./types"
import { WorkflowIndexLanding, workflowListQueryParams, workflowRunQueryParams } from "./index-page"
import {
  WorkflowBuilderSidebarCloser,
  WorkflowDetailLoadErrorState,
  WorkflowDetailLoadingState,
  WorkflowVersionToolbar,
  WorkflowViewTabs,
} from "./detail-chrome"
import { WorkflowSlackAppSetupModal } from "./slack-setup"
import { WorkflowSaveDialog, WorkflowValidationErrorsDialog } from "./save-dialog"
import { WorkflowCreationDialog, WorkflowOverview } from "./overview"
import { WorkflowBuilder } from "./builder"
import { getWorkflowConnectionDetails } from "./builder-canvas"
import {
  DeleteConnectionConfirmationModal,
  DeleteNodeConfirmationModal,
  DeleteRunConfirmationModal,
  DeleteWorkflowConfirmationModal,
  OverwriteManualInputConnectionModal,
  ReplaceInputConnectionModal,
  WebhookTestModal,
} from "./modals"
import {
  clearManualInputValue,
  createStarterEdges,
  createStarterNodes,
  findEdgeUsingTargetInput,
  getConnectionTargetInputKey,
  getEdgeTargetInputKey,
  getNormalizedTargetHandle,
  getTemplateManifest,
  hasManualInputValue,
  isSameConnection,
  migrateWorkflowManifestForBuilder,
  toCanvasEdge,
  toCanvasNode,
  toConnectionEdge,
  toManifest,
} from "./manifest-utils"
import {
  applyWorkflowSaveRevertAction,
  getWorkflowRuntimeVersionChangePreview,
  getWorkflowSaveChangeSummary,
  getWorkflowVersionSaveLabel,
  hasWorkflowSlackTriggers,
  stripWorkflowSaveChangeRevertActions,
} from "./save-utils"
import {
  buildWorkflowBuilderPrompt,
  buildWorkflowEditorPrompt,
  downloadTextFile,
  getErrorMessage,
  getLatestWebhookTestPayload,
  requestJson,
} from "./run-utils"
import { formatJson } from "./header-utils"
import { useWorkflowPageActions } from "./use-page-actions"
import { WorkflowsPageFrame } from "./page-frame"
import { useWorkflowPageCanvasActions } from "./use-page-canvas-actions"
import { useWorkflowPageData } from "./use-page-data"

export function WorkflowsPage({
  pathname,
  routeWorkflowId,
  initialProviderSettings = null,
}: {
  pathname: string
  routeWorkflowId?: string
  initialProviderSettings?: ProviderSettingsResponse | null
}) {
  const { catalog: providerCatalog, loading: providerLoading } = useProviderSettings({
    initialData: initialProviderSettings,
  })
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [workflowTotal, setWorkflowTotal] = useState(0)
  const [workflowListState, setWorkflowListState] = useState<WorkflowListTableState>(
    WORKFLOW_DEFAULT_TABLE_STATE,
  )
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    routeWorkflowId ?? null,
  )
  const [runTableState, setRunTableState] = useState<WorkflowRunTableState>(
    WORKFLOW_RUN_DEFAULT_TABLE_STATE,
  )
  const [runTableTotal, setRunTableTotal] = useState(0)
  const [runTotal, setRunTotal] = useState(0)
  const [runErrorsLast24Hours, setRunErrorsLast24Hours] = useState(0)
  const [runTableLoading, setRunTableLoading] = useState(false)
  const [workflowName, setWorkflowName] = useState("Untitled workflow")
  const [workflowTitleDraft, setWorkflowTitleDraft] = useState("Untitled workflow")
  const [savingWorkflowTitle, setSavingWorkflowTitle] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowCanvasNode>(createStarterNodes())
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowCanvasEdge>(createStarterEdges())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("webhook")
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [events, setEvents] = useState<WorkflowRunEvent[]>([])
  const [webhookTestNode, setWebhookTestNode] = useState<WorkflowManifestNode | null>(null)
  const [slackTestNode, setSlackTestNode] = useState<WorkflowManifestNode | null>(null)
  const [runSelectionPinned, setRunSelectionPinned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [workflowDetailLoadState, setWorkflowDetailLoadState] =
    useState<WorkflowDetailLoadState | null>(null)
  const [workflowDetailReloadNonce, setWorkflowDetailReloadNonce] = useState(0)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [nodePickerCollapsed, setNodePickerCollapsed] = useState(false)
  const [detailsCollapsed, setDetailsCollapsed] = useState(false)
  const [nodePendingDeletion, setNodePendingDeletion] = useState<WorkflowManifestNode | null>(null)
  const [edgePendingDeletionId, setEdgePendingDeletionId] = useState<string | null>(null)
  const [connectionPendingReplacement, setConnectionPendingReplacement] =
    useState<PendingConnectionReplacement | null>(null)
  const [connectionPendingManualOverwrite, setConnectionPendingManualOverwrite] =
    useState<PendingManualInputOverwrite | null>(null)
  const [workflowPendingDeletion, setWorkflowPendingDeletion] = useState<WorkflowSummary | null>(
    null,
  )
  const [runPendingDeletion, setRunPendingDeletion] = useState<WorkflowRun | null>(null)
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null)
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null)
  const [updatingWorkflowStatus, setUpdatingWorkflowStatus] = useState(false)
  const [activeTab, setActiveTab] = useState<WorkflowViewTab>("overview")
  const [runDetailsOpen, setRunDetailsOpen] = useState(false)
  const [creationDialogOpen, setCreationDialogOpen] = useState(false)
  const [creationMode, setCreationMode] = useState<WorkflowCreationMode>("templates")
  const [emptyStarterVisible, setEmptyStarterVisible] = useState(true)
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [builderPrompt, setBuilderPrompt] = useState("")
  const [builderRunning, setBuilderRunning] = useState(false)
  const [workflowAiChatOpen, setWorkflowAiChatOpen] = useState(false)
  const [workflowAiSessionId, setWorkflowAiSessionId] = useState<string | null>(null)
  const [workflowAiSending, setWorkflowAiSending] = useState(false)
  const [workflowAiContextRuns, setWorkflowAiContextRuns] = useState<
    ReadonlyMap<string, WorkflowRun>
  >(new Map())
  const [submittingApprovalNodeId, setSubmittingApprovalNodeId] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [workflowSaveDialog, setWorkflowSaveDialog] = useState<WorkflowSaveDialogState | null>(null)
  const [slackAppSetupOpen, setSlackAppSetupOpen] = useState(false)
  const [workflowHeaderDraftsByNode, setWorkflowHeaderDraftsByNode] = useState<
    Record<string, WorkflowHeaderDraftRow[]>
  >({})
  const [workflowValidationDialogOpen, setWorkflowValidationDialogOpen] = useState(false)
  const [workflowConfigFocusTarget, setWorkflowConfigFocusTarget] =
    useState<WorkflowConfigFocusTarget | null>(null)
  const workflowsLoadedRef = useRef(false)
  const workflowDetailLoadStateRef = useRef<WorkflowDetailLoadState | null>(null)
  const runsRef = useRef<WorkflowRun[]>([])
  const selectedRunIdRef = useRef<string | null>(null)
  const runSelectionPinnedRef = useRef(false)
  const navigationBypassRef = useRef(false)
  const workflowAiSessionIdRef = useRef<string | null>(null)
  const workflowAiSessionCreationPromiseRef = useRef<Promise<string> | null>(null)
  const runFetchSequenceRef = useRef(0)

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null
  const selectedWorkflowName = selectedWorkflow?.name
  const workflowTitle = selectedWorkflowName ?? workflowName
  const workflowTitleDraftTrimmed = workflowTitleDraft.trim()
  const selectedWorkflowDetailState =
    selectedWorkflowId && workflowDetailLoadState?.workflowId === selectedWorkflowId
      ? workflowDetailLoadState
      : null
  const selectedWorkflowReady =
    !selectedWorkflowId || selectedWorkflowDetailState?.phase === "ready"
  const selectedWorkflowLoadError =
    selectedWorkflowDetailState?.phase === "error" ? selectedWorkflowDetailState.message : null
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null
  const connectionPendingDeletion = useMemo(
    () =>
      getWorkflowConnectionDetails(
        edgePendingDeletionId
          ? (edges.find((edge) => edge.id === edgePendingDeletionId) ?? null)
          : null,
        nodes,
      ),
    [edgePendingDeletionId, edges, nodes],
  )
  const webhookUrl = selectedWorkflow?.webhookUrl ?? ""
  const workflowDisabled = selectedWorkflow?.status === "disabled"
  const runnableTriggerNode = useMemo(() => {
    if (
      selectedNode &&
      getWorkflowNodeDefinitionForNode(selectedNode.data.node)?.category === "trigger"
    ) {
      return selectedNode.data.node
    }

    return (
      nodes.find((node) => getWorkflowNodeDefinitionForNode(node.data.node)?.category === "trigger")
        ?.data.node ?? null
    )
  }, [nodes, selectedNode])
  const currentManifest = useMemo(
    () => toManifest(workflowName, nodes, edges),
    [edges, nodes, workflowName],
  )
  const currentManifestHasSlackTriggers = useMemo(
    () => hasWorkflowSlackTriggers(currentManifest),
    [currentManifest],
  )
  const workflowConfigErrorsByNode = useMemo(
    () => getWorkflowNodeConfigErrorsByNode(nodes, workflowHeaderDraftsByNode),
    [nodes, workflowHeaderDraftsByNode],
  )
  const workflowConfigErrors = useMemo(
    () => getWorkflowNodeConfigErrorDetails(workflowConfigErrorsByNode, nodes),
    [nodes, workflowConfigErrorsByNode],
  )
  const selectedHeaderDraftRows = selectedNode
    ? (workflowHeaderDraftsByNode[selectedNode.data.node.id] ?? null)
    : null
  const workflowHasSaveDiff = useMemo(() => {
    if (!selectedWorkflowId) {
      return !emptyStarterVisible
    }
    if (!selectedWorkflow?.manifest) {
      return false
    }
    return formatJson(currentManifest) !== formatJson(selectedWorkflow.manifest)
  }, [currentManifest, emptyStarterVisible, selectedWorkflow?.manifest, selectedWorkflowId])
  const workflowTitleDirty = Boolean(
    selectedWorkflowId && selectedWorkflowReady && workflowTitleDraftTrimmed !== workflowTitle,
  )
  const workflowTitleInvalid = Boolean(
    selectedWorkflowId && selectedWorkflowReady && workflowTitleDraftTrimmed.length === 0,
  )
  const workflowDirty = workflowConfigErrors.length > 0 || workflowHasSaveDiff
  const modelOptions = useMemo(
    () => providerCatalog?.modelOptions ?? [],
    [providerCatalog?.modelOptions],
  )
  const builderNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          workflowDisabled,
          hasValidationErrors: Boolean(workflowConfigErrorsByNode[node.data.node.id]?.length),
        },
      })),
    [nodes, workflowConfigErrorsByNode, workflowDisabled],
  )
  const showWorkflowIndexView = !selectedWorkflowId && emptyStarterVisible
  const showWorkflowDetailLoader = Boolean(
    selectedWorkflowId && !selectedWorkflowReady && !selectedWorkflowLoadError,
  )

  const setWorkflowDetailLoadStateValue = useCallback((state: WorkflowDetailLoadState | null) => {
    workflowDetailLoadStateRef.current = state
    setWorkflowDetailLoadState(state)
  }, [])

  const updateWorkflowHeaderDraftRows = useCallback(
    (nodeId: string, rows: WorkflowHeaderDraftRow[]) => {
      setWorkflowHeaderDraftsByNode((current) => ({ ...current, [nodeId]: rows }))
    },
    [],
  )
  const openWorkflowConfigError = useCallback((configError: WorkflowNodeConfigErrorDetails) => {
    setActiveTab("builder")
    setSelectedNodeId(configError.nodeId)
    setSelectedEdgeId(null)
    setDetailsCollapsed(false)
    setWorkflowValidationDialogOpen(false)
    setWorkflowConfigFocusTarget({
      nodeId: configError.nodeId,
      configLabel: configError.configLabel,
    })
  }, [])
  const clearWorkflowConfigFocusTarget = useCallback(() => {
    setWorkflowConfigFocusTarget(null)
  }, [])

  useEffect(() => {
    const nodeIds = new Set(nodes.map((node) => node.data.node.id))
    setWorkflowHeaderDraftsByNode((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => nodeIds.has(nodeId)),
      )
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [nodes])

  const showWorkflowIndex = useCallback(
    (replace = false) => {
      void navigate({ to: "/workflows", replace })
    },
    [navigate],
  )

  const showWorkflowRoute = useCallback(
    (workflowId: string, replace = false) => {
      void navigate({
        to: "/workflows/$workflowId",
        params: { workflowId },
        replace,
      })
    },
    [navigate],
  )

  const clearWorkflowSelection = useCallback(() => {
    setSelectedWorkflowId(null)
    setWorkflowDetailLoadStateValue(null)
    setSelectedRunId(null)
    setRunSelectionPinned(false)
    setRunDetailsOpen(false)
    setWebhookTestNode(null)
    setSlackAppSetupOpen(false)
    setRunPendingDeletion(null)
    setRuns([])
    setRunTableState(WORKFLOW_RUN_DEFAULT_TABLE_STATE)
    setRunTableTotal(0)
    setRunTotal(0)
    setRunErrorsLast24Hours(0)
    setRunTableLoading(false)
    setEvents([])
    setSlackTestNode(null)
    setWorkflowHeaderDraftsByNode({})
  }, [setWorkflowDetailLoadStateValue])

  const resetWorkflowDraft = useCallback(
    (tab: WorkflowViewTab = "builder") => {
      clearWorkflowSelection()
      const manifest = getTemplateManifest("scratch")
      setWorkflowName(manifest.name)
      setNodes(manifest.nodes.map(toCanvasNode))
      setEdges(manifest.edges.map(toCanvasEdge))
      setSelectedNodeId(manifest.nodes[0]?.id ?? null)
      setSelectedEdgeId(null)
      setImportWarnings([])
      setWorkflowHeaderDraftsByNode({})
      setActiveTab(tab)
      setEmptyStarterVisible(true)
      showWorkflowIndex()
    },
    [clearWorkflowSelection, setEdges, setNodes, showWorkflowIndex],
  )

  const loadWorkflowDraft = useCallback(
    (manifest: WorkflowManifest, warnings: string[] = []) => {
      const builderManifest = migrateWorkflowManifestForBuilder(manifest)
      clearWorkflowSelection()
      setWorkflowName(builderManifest.name)
      setNodes(builderManifest.nodes.map(toCanvasNode))
      setEdges(builderManifest.edges.map(toCanvasEdge))
      setSelectedNodeId(builderManifest.nodes[0]?.id ?? null)
      setSelectedEdgeId(null)
      setImportWarnings(warnings)
      setWorkflowHeaderDraftsByNode({})
      setActiveTab("builder")
      setCreationDialogOpen(false)
      setEmptyStarterVisible(false)
      showWorkflowIndex()
    },
    [clearWorkflowSelection, setEdges, setNodes, showWorkflowIndex],
  )

  const createWorkflowAiSession = useCallback(async () => {
    if (workflowAiSessionIdRef.current) {
      return workflowAiSessionIdRef.current
    }
    if (workflowAiSessionCreationPromiseRef.current) {
      return workflowAiSessionCreationPromiseRef.current
    }

    const promise = (async () => {
      const created = await requestJson<{ sessionId: string }>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKind: "isolate",
          title: "Workflow builder",
          tools: [{ kind: "workflow_builder" }],
        }),
      })
      workflowAiSessionIdRef.current = created.sessionId
      setWorkflowAiSessionId(created.sessionId)
      return created.sessionId
    })()

    workflowAiSessionCreationPromiseRef.current = promise
    try {
      return await promise
    } finally {
      if (workflowAiSessionCreationPromiseRef.current === promise) {
        workflowAiSessionCreationPromiseRef.current = null
      }
    }
  }, [])

  const enqueueWorkflowAiPrompt = useCallback(
    async (input: { content: string }) => {
      const sessionId = await createWorkflowAiSession()
      await requestJson<{ messageId: string; status: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: input.content, source: "web" }),
        },
      )
      return sessionId
    },
    [createWorkflowAiSession],
  )

  const startWorkflowAiTurn = useCallback(
    async (input: { prompt: string; mode: "build" | "edit"; runs?: WorkflowRun[] }) => {
      const prompt = input.prompt.trim()
      if (!prompt) {
        showErrorToast(
          input.mode === "build"
            ? "Describe the workflow you want to build."
            : "Describe the workflow edit you want.",
        )
        return
      }

      setWorkflowAiSending(true)
      setWorkflowAiChatOpen(true)
      if (input.mode === "build") {
        setActiveTab("builder")
        setCreationDialogOpen(false)
        setEmptyStarterVisible(false)
        showWorkflowIndex()
      }
      try {
        const runEventsById =
          input.mode === "edit" && selectedWorkflowId && input.runs?.length
            ? Object.fromEntries(
                await Promise.all(
                  input.runs.map(async (run) => {
                    const response = await requestJson<{ events: WorkflowRunEvent[] }>(
                      `/api/workflows/${encodeURIComponent(selectedWorkflowId)}/runs/${encodeURIComponent(run.id)}/events`,
                    )
                    return [run.id, response.events] as const
                  }),
                ),
              )
            : undefined
        const content =
          input.mode === "build"
            ? buildWorkflowBuilderPrompt(prompt)
            : buildWorkflowEditorPrompt({
                userPrompt: prompt,
                manifest: currentManifest,
                runs: input.runs,
                runEventsById,
              })
        await enqueueWorkflowAiPrompt({ content })
        if (input.mode === "build") {
          setBuilderPrompt("")
        }
      } catch (errorValue) {
        showErrorToast(getErrorMessage(errorValue))
      } finally {
        setWorkflowAiSending(false)
      }
    },
    [currentManifest, enqueueWorkflowAiPrompt, selectedWorkflowId, showWorkflowIndex],
  )

  const openWorkflowAiDialog = useCallback(() => {
    const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
    setWorkflowAiContextRuns(selectedRun ? new Map([[selectedRun.id, selectedRun]]) : new Map())
    setWorkflowAiChatOpen(true)
  }, [runs, selectedRunId])

  const toggleWorkflowAiContextRun = useCallback((run: WorkflowRun, selected: boolean) => {
    setWorkflowAiContextRuns((current) => {
      const next = new Map(current)
      if (selected) {
        next.set(run.id, run)
      } else {
        next.delete(run.id)
      }
      return next
    })
  }, [])

  const toggleVisibleWorkflowAiContextRuns = useCallback(
    (visibleRuns: WorkflowRun[], selected: boolean) => {
      setWorkflowAiContextRuns((current) => {
        const next = new Map(current)
        for (const run of visibleRuns) {
          if (selected) {
            next.set(run.id, run)
          } else {
            next.delete(run.id)
          }
        }
        return next
      })
    },
    [],
  )

  useEffect(() => {
    runsRef.current = runs
  }, [runs])

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  useEffect(() => {
    runSelectionPinnedRef.current = runSelectionPinned
  }, [runSelectionPinned])

  useEffect(() => {
    if (selectedWorkflowId && selectedWorkflowName !== undefined) {
      setWorkflowTitleDraft(selectedWorkflowName)
      return
    }
    if (!selectedWorkflowId) {
      setWorkflowTitleDraft(workflowName)
    }
  }, [selectedWorkflowId, selectedWorkflowName, workflowName])

  const selectWorkflowState = useCallback(
    (workflowId: string) => {
      setSelectedWorkflowId(workflowId)
      setWorkflowDetailLoadStateValue({ workflowId, phase: "loading" })
      setEmptyStarterVisible(false)
      setSelectedRunId(null)
      setRunSelectionPinned(false)
      setRunDetailsOpen(false)
      setWebhookTestNode(null)
      setSlackAppSetupOpen(false)
      setRunPendingDeletion(null)
      setRuns([])
      setRunTableState(WORKFLOW_RUN_DEFAULT_TABLE_STATE)
      setRunTableTotal(0)
      setRunTotal(0)
      setRunErrorsLast24Hours(0)
      setRunTableLoading(false)
      setEvents([])
    },
    [setWorkflowDetailLoadStateValue],
  )

  const selectWorkflow = useCallback(
    (workflowId: string, replace = false) => {
      selectWorkflowState(workflowId)
      showWorkflowRoute(workflowId, replace)
    },
    [selectWorkflowState, showWorkflowRoute],
  )

  useEffect(() => {
    if (!routeWorkflowId) {
      if (pathname === "/workflows" && workflowsLoadedRef.current && selectedWorkflowId) {
        resetWorkflowDraft()
      }
      return
    }

    if (routeWorkflowId !== selectedWorkflowId) {
      selectWorkflowState(routeWorkflowId)
    }
  }, [pathname, resetWorkflowDraft, routeWorkflowId, selectWorkflowState, selectedWorkflowId])
  const {
    loadEvents,
    loadRuns,
    loadWorkflow,
    loadWorkflows,
    submitApproval,
    workflowDetailFetchSequenceRef,
    workflowFetchSequenceRef,
  } = useWorkflowPageData({
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
  })
  const {
    addNode,
    clearCanvasNodeSelection,
    confirmConnectionReplacement,
    confirmManualInputOverwrite,
    deleteEdge,
    deleteNode,
    handleEdgesChange,
    onConnect,
    openNodeCatalog,
    removeSelectedNodeInputHandle,
    renameSelectedNode,
    renameSelectedNodeInputHandle,
    selectCanvasEdge,
    selectCanvasNode,
    updateSelectedNode,
  } = useWorkflowPageCanvasActions({
    connectionPendingManualOverwrite,
    connectionPendingReplacement,
    edges,
    nodes,
    onEdgesChange,
    selectedEdgeId,
    selectedNodeId,
    setConnectionPendingManualOverwrite,
    setConnectionPendingReplacement,
    setDetailsCollapsed,
    setEdgePendingDeletionId,
    setEdges,
    setNodePendingDeletion,
    setNodePickerCollapsed,
    setNodes,
    setSelectedEdgeId,
    setSelectedNodeId,
    setWebhookTestNode,
    setWorkflowHeaderDraftsByNode,
  })
  const {
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
  } = useWorkflowPageActions({
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
    setSavingWorkflowTitle,
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
  })
  return (
    <WorkflowsPageFrame
      activeTab={activeTab}
      addNode={addNode}
      buildWorkflowWithLlm={buildWorkflowWithLlm}
      builderNodes={builderNodes}
      builderPrompt={builderPrompt}
      builderRunning={builderRunning}
      clearCanvasNodeSelection={clearCanvasNodeSelection}
      clearWorkflowConfigFocusTarget={clearWorkflowConfigFocusTarget}
      closeWorkflowSaveDialog={closeWorkflowSaveDialog}
      confirmConnectionReplacement={confirmConnectionReplacement}
      confirmManualInputOverwrite={confirmManualInputOverwrite}
      confirmWorkflowSave={confirmWorkflowSave}
      connectionPendingDeletion={connectionPendingDeletion}
      connectionPendingManualOverwrite={connectionPendingManualOverwrite}
      connectionPendingReplacement={connectionPendingReplacement}
      createDraftFromTemplate={createDraftFromTemplate}
      creationDialogOpen={creationDialogOpen}
      creationMode={creationMode}
      currentManifestHasSlackTriggers={currentManifestHasSlackTriggers}
      deleteEdge={deleteEdge}
      deleteNode={deleteNode}
      deleteWorkflow={deleteWorkflow}
      deleteWorkflowRun={deleteWorkflowRun}
      deletingRunId={deletingRunId}
      deletingWorkflowId={deletingWorkflowId}
      detailsCollapsed={detailsCollapsed}
      edges={edges}
      events={events}
      exportSelectedWorkflow={exportSelectedWorkflow}
      handleEdgesChange={handleEdgesChange}
      importWarnings={importWarnings}
      importWorkflowFile={importWorkflowFile}
      loadWorkflowDraft={loadWorkflowDraft}
      loading={loading}
      modelOptions={modelOptions}
      providerCatalogLoading={providerLoading}
      navigationBlocker={navigationBlocker}
      nodePendingDeletion={nodePendingDeletion}
      nodePickerCollapsed={nodePickerCollapsed}
      nodes={nodes}
      onConnect={onConnect}
      onEdgesChange={onEdgesChange}
      onNodesChange={onNodesChange}
      openNodeCatalog={openNodeCatalog}
      openWorkflowConfigError={openWorkflowConfigError}
      openWorkflowCreationMode={openWorkflowCreationMode}
      openWorkflowSaveDialog={openWorkflowSaveDialog}
      openWorkflowAiDialog={openWorkflowAiDialog}
      removeSelectedNodeInputHandle={removeSelectedNodeInputHandle}
      renameSelectedNode={renameSelectedNode}
      renameSelectedNodeInputHandle={renameSelectedNodeInputHandle}
      revertWorkflowSaveDialogChange={revertWorkflowSaveDialogChange}
      runDetailsOpen={runDetailsOpen}
      runErrorsLast24Hours={runErrorsLast24Hours}
      runPendingDeletion={runPendingDeletion}
      runTableLoading={runTableLoading}
      runTableState={runTableState}
      runTableTotal={runTableTotal}
      runTotal={runTotal}
      runTrigger={runTrigger}
      runnableTriggerNode={runnableTriggerNode}
      running={running}
      runs={runs}
      saveBeforeNavigation={saveBeforeNavigation}
      saving={saving}
      savingWorkflowTitle={savingWorkflowTitle}
      saveWorkflowTitle={saveWorkflowTitle}
      savingBeforeNavigation={savingBeforeNavigation}
      selectCanvasEdge={selectCanvasEdge}
      selectCanvasNode={selectCanvasNode}
      selectRun={selectRun}
      selectWorkflow={selectWorkflow}
      selectedEdge={selectedEdge}
      selectedHeaderDraftRows={selectedHeaderDraftRows}
      selectedNode={selectedNode}
      selectedRunId={selectedRunId}
      selectedWorkflow={selectedWorkflow}
      selectedWorkflowId={selectedWorkflowId}
      selectedWorkflowLoadError={selectedWorkflowLoadError}
      selectedWorkflowReady={selectedWorkflowReady}
      setActiveTab={setActiveTab}
      setBuilderPrompt={setBuilderPrompt}
      setConnectionPendingManualOverwrite={setConnectionPendingManualOverwrite}
      setConnectionPendingReplacement={setConnectionPendingReplacement}
      setCreationDialogOpen={setCreationDialogOpen}
      setDetailsCollapsed={setDetailsCollapsed}
      setEdgePendingDeletionId={setEdgePendingDeletionId}
      setNodePendingDeletion={setNodePendingDeletion}
      setNodePickerCollapsed={setNodePickerCollapsed}
      setRunDetailsOpen={setRunDetailsOpen}
      setRunPendingDeletion={setRunPendingDeletion}
      setRunTableState={setRunTableState}
      setSlackAppSetupOpen={setSlackAppSetupOpen}
      setSlackTestNode={setSlackTestNode}
      setWebhookTestNode={setWebhookTestNode}
      setWorkflowAiChatOpen={setWorkflowAiChatOpen}
      setWorkflowDetailReloadNonce={setWorkflowDetailReloadNonce}
      setWorkflowEnabled={setWorkflowEnabled}
      setWorkflowListState={setWorkflowListState}
      setWorkflowName={setWorkflowName}
      setWorkflowTitleDraft={setWorkflowTitleDraft}
      setWorkflowPendingDeletion={setWorkflowPendingDeletion}
      setWorkflowValidationDialogOpen={setWorkflowValidationDialogOpen}
      showWorkflowDetailLoader={showWorkflowDetailLoader}
      showWorkflowIndexView={showWorkflowIndexView}
      slackAppSetupOpen={slackAppSetupOpen}
      slackTestNode={slackTestNode}
      startWorkflowAiTurn={startWorkflowAiTurn}
      submitApproval={submitApproval}
      submittingApprovalNodeId={submittingApprovalNodeId}
      testTriggerNode={testTriggerNode}
      updateSelectedNode={updateSelectedNode}
      updateWorkflowHeaderDraftRows={updateWorkflowHeaderDraftRows}
      updatingWorkflowStatus={updatingWorkflowStatus}
      webhookTestNode={webhookTestNode}
      webhookUrl={webhookUrl}
      workflowAiChatOpen={workflowAiChatOpen}
      workflowAiContextRuns={workflowAiContextRuns}
      workflowAiSending={workflowAiSending}
      workflowAiSessionId={workflowAiSessionId}
      toggleWorkflowAiContextRun={toggleWorkflowAiContextRun}
      toggleVisibleWorkflowAiContextRuns={toggleVisibleWorkflowAiContextRuns}
      workflowConfigErrors={workflowConfigErrors}
      workflowConfigFocusTarget={workflowConfigFocusTarget}
      workflowDisabled={workflowDisabled}
      workflowHasSaveDiff={workflowHasSaveDiff}
      workflowListState={workflowListState}
      workflowName={workflowName}
      workflowTitleDraft={workflowTitleDraft}
      workflowTitleDirty={workflowTitleDirty}
      workflowTitleInvalid={workflowTitleInvalid}
      workflowPendingDeletion={workflowPendingDeletion}
      workflowSaveDialog={workflowSaveDialog}
      workflowTotal={workflowTotal}
      workflowValidationDialogOpen={workflowValidationDialogOpen}
      workflows={workflows}
    />
  )
}
