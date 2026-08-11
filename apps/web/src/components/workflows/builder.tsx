import {
  Background,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react"
import { ChevronDown, KeyRound, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import {
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  type RuntimeModelCategory,
  type WorkflowManifestNode,
  type WorkflowNodeCategory,
  type WorkflowNodeDefinition,
  type WorkflowNodeType,
} from "@solzero/shared"
import { useAuthSession } from "@/lib/auth-client"
import {
  CATALOG_PREVIEW_ESTIMATED_HEIGHT,
  CATALOG_PREVIEW_OFFSET,
  centerWorkflowCanvasViewport,
  getCatalogPreviewTop,
  getWorkflowCanvasNodeCenter,
  getWorkflowNodeDragType,
  getWorkflowNodePositionCenter,
  GROUPED_WORKFLOW_NODE_CATALOG,
  hasWorkflowNodeDragData,
  nodeTypes,
  REACT_FLOW_PRO_OPTIONS,
  WORKFLOW_CANVAS_FIT_VIEW_OPTIONS,
  WORKFLOW_CANVAS_MIN_ZOOM,
  WORKFLOW_LEFT_PANEL_WIDTH,
  WORKFLOW_NODE_CATEGORY_LABELS,
  WORKFLOW_NODE_DRAG_MIME_TYPE,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowConfigFocusTarget,
  WorkflowHeaderDraftRow,
  WorkflowNodeCatalogItem,
} from "./types"
import { WorkflowCanvasControls } from "./detail-chrome"
import {
  CatalogPortPreview,
  ConnectionInspector,
  getConnectedInputTemplates,
  getWorkflowConnectionDetails,
  GlobalVariablesModal,
} from "./builder-canvas"
import { NodeInspector } from "./node-inspector"
import { getWorkflowNodeCategoryIcon, WorkflowNodeCatalogSubButton } from "./session-controls"
import { SlackMarkIcon } from "./slack-mark-icon"

export function WorkflowBuilder({
  workflowId,
  runId,
  nodes,
  edges,
  selectedNode,
  selectedNodeDefinition,
  selectedEdge,
  webhookUrl,
  modelOptions,
  providerCatalogLoading,
  nodePickerCollapsed,
  detailsCollapsed,
  configFocusTarget,
  selectedHeaderDraftRows,
  nodeIds,
  showSaveButton,
  saving,
  onAddNode,
  onSave,
  onSetNodePickerCollapsed,
  onSetDetailsCollapsed,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onOpenNodeCatalog,
  onCopyWebhook,
  onHeaderDraftRowsChange,
  onChangeSelectedNode,
  onConfigFocusComplete,
  onRenameSelectedNode,
  onRenameSelectedInputHandle,
  onRemoveSelectedInputHandle,
  onRequestDeleteEdge,
  onRequestDeleteNode,
}: {
  workflowId: string | null
  runId: string | null
  nodes: WorkflowCanvasNode[]
  edges: WorkflowCanvasEdge[]
  selectedNode: WorkflowManifestNode | null
  selectedNodeDefinition: WorkflowNodeDefinition | null
  selectedEdge: WorkflowCanvasEdge | null
  webhookUrl: string
  modelOptions: RuntimeModelCategory[]
  providerCatalogLoading: boolean
  nodePickerCollapsed: boolean
  detailsCollapsed: boolean
  configFocusTarget: WorkflowConfigFocusTarget | null
  selectedHeaderDraftRows: WorkflowHeaderDraftRow[] | null
  nodeIds: string[]
  showSaveButton: boolean
  saving: boolean
  onAddNode: (type: WorkflowNodeType, position?: WorkflowManifestNode["position"]) => void
  onSave: () => void
  onSetNodePickerCollapsed: (collapsed: boolean) => void
  onSetDetailsCollapsed: (collapsed: boolean) => void
  onNodesChange: OnNodesChange<WorkflowCanvasNode>
  onEdgesChange: OnEdgesChange<WorkflowCanvasEdge>
  onConnect: OnConnect
  onNodeClick: (nodeId: string) => void
  onEdgeClick: (edgeId: string) => void
  onPaneClick: () => void
  onOpenNodeCatalog: () => void
  onCopyWebhook: () => void
  onHeaderDraftRowsChange: (nodeId: string, rows: WorkflowHeaderDraftRow[]) => void
  onChangeSelectedNode: (updater: (node: WorkflowManifestNode) => WorkflowManifestNode) => void
  onConfigFocusComplete: () => void
  onRenameSelectedNode: (nodeId: string) => boolean
  onRenameSelectedInputHandle: (previousHandle: string, nextHandle: string) => void
  onRemoveSelectedInputHandle: (handle: string) => void
  onRequestDeleteEdge: (edgeId: string) => void
  onRequestDeleteNode: (node: WorkflowManifestNode) => void
}) {
  const [globalVariablesOpen, setGlobalVariablesOpen] = useState(false)
  const [draggedCatalogItemId, setDraggedCatalogItemId] = useState<WorkflowNodeType | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<
    WorkflowCanvasNode,
    WorkflowCanvasEdge
  > | null>(null)
  const [hoveredCatalogItem, setHoveredCatalogItem] = useState<{
    item: WorkflowNodeCatalogItem
    anchorTop: number
    anchorHeight: number
    left: number
    top: number
  } | null>(null)
  const catalogPreviewRef = useRef<HTMLDivElement | null>(null)
  const { data: authSession } = useAuthSession()
  const isAdmin = authSession?.isAdmin === true
  const selectedConnection = useMemo(
    () => getWorkflowConnectionDetails(selectedEdge, nodes),
    [nodes, selectedEdge],
  )
  const displayedEdges = useMemo(
    () =>
      edges.map((edge) =>
        edge.id === selectedEdge?.id
          ? {
              ...edge,
              selected: true,
              style: { ...edge.style, stroke: "var(--color-kumo-brand)", strokeWidth: 2 },
            }
          : { ...edge, selected: false },
      ),
    [edges, selectedEdge?.id],
  )
  const confirmElementDeleteBeforeCanvasDelete = useCallback<
    OnBeforeDelete<WorkflowCanvasNode, WorkflowCanvasEdge>
  >(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }) => {
      const nodeToDelete = nodesToDelete[0]?.data.node
      if (nodeToDelete) {
        onRequestDeleteNode(nodeToDelete)
        return false
      }

      const edgeToDelete = edgesToDelete[0]
      if (edgeToDelete) {
        onRequestDeleteEdge(edgeToDelete.id)
        return false
      }

      return true
    },
    [onRequestDeleteEdge, onRequestDeleteNode],
  )
  const detailsViewActive = Boolean(selectedNode || selectedConnection)
  const leftPanelCollapsed = detailsViewActive ? detailsCollapsed : nodePickerCollapsed
  const connectedInputTemplates = useMemo(
    () => (selectedNode ? getConnectedInputTemplates(selectedNode, nodes, edges) : []),
    [edges, nodes, selectedNode],
  )
  const showCatalogItemPreview = (item: WorkflowNodeCatalogItem, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setHoveredCatalogItem({
      item,
      anchorTop: rect.top,
      anchorHeight: rect.height,
      left: rect.right + CATALOG_PREVIEW_OFFSET,
      top: getCatalogPreviewTop(rect.top, rect.height, CATALOG_PREVIEW_ESTIMATED_HEIGHT),
    })
  }
  const startCatalogItemDrag = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>, item: WorkflowNodeCatalogItem) => {
      event.dataTransfer.effectAllowed = "copy"
      event.dataTransfer.setData(WORKFLOW_NODE_DRAG_MIME_TYPE, item.definition.type)
      event.dataTransfer.setData("text/plain", item.definition.type)
      event.dataTransfer.setDragImage(event.currentTarget, 16, event.currentTarget.clientHeight / 2)
      setDraggedCatalogItemId(item.id)
      setHoveredCatalogItem(null)
    },
    [],
  )
  const stopCatalogItemDrag = useCallback(() => {
    setDraggedCatalogItemId(null)
  }, [])
  const onCanvasDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasWorkflowNodeDragData(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])
  const onCanvasDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasWorkflowNodeDragData(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      setDraggedCatalogItemId(null)
      const droppedType = getWorkflowNodeDragType(event.dataTransfer)
      if (!droppedType || !reactFlowInstance) {
        return
      }

      const dropPosition = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      onAddNode(droppedType, dropPosition)
      const nodeCenter = getWorkflowNodePositionCenter(dropPosition)
      centerWorkflowCanvasViewport(reactFlowInstance, nodeCenter)
    },
    [onAddNode, reactFlowInstance],
  )
  const centerCanvasOnNode = useCallback(
    (node: WorkflowCanvasNode) => {
      if (!reactFlowInstance) {
        return
      }

      const nodeCenter = getWorkflowCanvasNodeCenter(node)
      window.requestAnimationFrame(() => {
        centerWorkflowCanvasViewport(reactFlowInstance, nodeCenter)
      })
    },
    [reactFlowInstance],
  )
  const selectAndCenterCanvasNode = useCallback(
    (node: WorkflowCanvasNode) => {
      onNodeClick(node.id)
      centerCanvasOnNode(node)
    },
    [centerCanvasOnNode, onNodeClick],
  )

  useLayoutEffect(() => {
    if (!hoveredCatalogItem || !catalogPreviewRef.current) {
      return
    }

    const measuredTop = getCatalogPreviewTop(
      hoveredCatalogItem.anchorTop,
      hoveredCatalogItem.anchorHeight,
      catalogPreviewRef.current.offsetHeight,
    )
    if (Math.abs(measuredTop - hoveredCatalogItem.top) < 1) {
      return
    }

    setHoveredCatalogItem((current) =>
      current && current.item.id === hoveredCatalogItem.item.id
        ? { ...current, top: measuredTop }
        : current,
    )
  }, [hoveredCatalogItem])

  return (
    <div
      className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
      style={{
        gridTemplateColumns: `${leftPanelCollapsed ? "0px" : `${WORKFLOW_LEFT_PANEL_WIDTH}px`} minmax(0, 1fr)`,
      }}
    >
      <aside
        className={`relative min-h-0 border-r border-kumo-hairline ${
          leftPanelCollapsed ? "overflow-visible p-0" : "flex flex-col overflow-hidden"
        }`}
      >
        {leftPanelCollapsed ? (
          <button
            type="button"
            onClick={() =>
              detailsViewActive ? onSetDetailsCollapsed(false) : onSetNodePickerCollapsed(false)
            }
            className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-lg bg-kumo-base px-2.5 py-2 text-xs font-medium text-kumo-subtle shadow-sm ring-1 ring-kumo-line transition-[background-color,color,box-shadow] hover:bg-kumo-tint hover:text-kumo-default"
            title={detailsViewActive ? "Show details" : "Show node picker"}
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
            <span>{detailsViewActive ? "Details" : "Nodes"}</span>
          </button>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className={`absolute inset-0 flex min-h-0 flex-col transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none ${
                detailsViewActive
                  ? "pointer-events-none -translate-x-6 opacity-0"
                  : "translate-x-0 opacity-100"
              }`}
            >
              <WorkflowNodeCatalogPanel
                draggedCatalogItemId={draggedCatalogItemId}
                onAddNode={onAddNode}
                onCollapse={() => onSetNodePickerCollapsed(true)}
                onOpenGlobalVariables={() => setGlobalVariablesOpen(true)}
                onDragStart={startCatalogItemDrag}
                onDragEnd={stopCatalogItemDrag}
                onPreview={showCatalogItemPreview}
                onClearPreview={() => setHoveredCatalogItem(null)}
              />
            </div>
            <div
              className={`absolute inset-0 flex min-h-0 flex-col transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none ${
                detailsViewActive
                  ? "translate-x-0 opacity-100"
                  : "pointer-events-none translate-x-6 opacity-0"
              }`}
            >
              {selectedConnection ? (
                <ConnectionInspector
                  connection={selectedConnection}
                  onDelete={() => onRequestDeleteEdge(selectedConnection.edge.id)}
                  panelAction={
                    <WorkflowBuilderPanelCollapseButton
                      title="Collapse connection details"
                      onClick={() => onSetDetailsCollapsed(true)}
                    />
                  }
                />
              ) : selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  definition={selectedNodeDefinition}
                  connectedInputTemplates={connectedInputTemplates}
                  edges={edges}
                  nodes={nodes.map((canvasNode) => canvasNode.data.node)}
                  webhookUrl={webhookUrl}
                  modelOptions={modelOptions}
                  providerCatalogLoading={providerCatalogLoading}
                  isAdmin={isAdmin}
                  nodeIds={nodeIds}
                  configFocusTarget={configFocusTarget}
                  headerDraftRows={selectedHeaderDraftRows}
                  onCopyWebhook={onCopyWebhook}
                  onHeaderDraftRowsChange={onHeaderDraftRowsChange}
                  onChange={onChangeSelectedNode}
                  onConfigFocusComplete={onConfigFocusComplete}
                  onRename={onRenameSelectedNode}
                  onRenameInputHandle={onRenameSelectedInputHandle}
                  onRemoveInputHandle={onRemoveSelectedInputHandle}
                  onRequestDelete={onRequestDeleteNode}
                  breadcrumb={{
                    label: selectedNode.label,
                    onNodesClick: onOpenNodeCatalog,
                  }}
                  panelAction={
                    <WorkflowBuilderPanelCollapseButton
                      title="Collapse node details"
                      onClick={() => onSetDetailsCollapsed(true)}
                    />
                  }
                />
              ) : null}
            </div>
          </div>
        )}
        {hoveredCatalogItem ? (
          <div
            ref={catalogPreviewRef}
            className="pointer-events-none fixed z-50 w-72 rounded-lg bg-kumo-base p-3 shadow-xl ring-1 ring-kumo-line"
            style={{ left: hoveredCatalogItem.left, top: hoveredCatalogItem.top }}
          >
            <CatalogPortPreview definition={hoveredCatalogItem.item.definition} />
          </div>
        ) : null}
      </aside>
      {globalVariablesOpen ? (
        <GlobalVariablesModal
          workflowId={workflowId}
          runId={runId}
          userId={authSession?.user.id ?? null}
          onClose={() => setGlobalVariablesOpen(false)}
        />
      ) : null}

      <main className="relative min-w-0 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          deleteKeyCode={["Backspace", "Delete"]}
          onBeforeDelete={confirmElementDeleteBeforeCanvasDelete}
          onInit={setReactFlowInstance}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => selectAndCenterCanvasNode(node)}
          onEdgeClick={(_event, edge) => onEdgeClick(edge.id)}
          onPaneClick={onPaneClick}
          proOptions={REACT_FLOW_PRO_OPTIONS}
          fitView
          fitViewOptions={WORKFLOW_CANVAS_FIT_VIEW_OPTIONS}
          minZoom={WORKFLOW_CANVAS_MIN_ZOOM}
        >
          <Background />
        </ReactFlow>
        <WorkflowCanvasControls saveVisible={showSaveButton} saving={saving} onSave={onSave} />
      </main>
    </div>
  )
}

export function WorkflowNodeCatalogPanel({
  draggedCatalogItemId,
  onAddNode,
  onCollapse,
  onOpenGlobalVariables,
  onDragStart,
  onDragEnd,
  onPreview,
  onClearPreview,
}: {
  draggedCatalogItemId: WorkflowNodeType | null
  onAddNode: (type: WorkflowNodeType, position?: WorkflowManifestNode["position"]) => void
  onCollapse: () => void
  onOpenGlobalVariables: () => void
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>, item: WorkflowNodeCatalogItem) => void
  onDragEnd: () => void
  onPreview: (item: WorkflowNodeCatalogItem, element: HTMLElement) => void
  onClearPreview: () => void
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<WorkflowNodeCategory>>(
    () => new Set(),
  )
  const toggleCategory = useCallback((category: WorkflowNodeCategory) => {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkflowBuilderPanelTitleBar
        action={
          <WorkflowBuilderPanelCollapseButton title="Collapse node picker" onClick={onCollapse} />
        }
      >
        <span className="min-w-0 truncate font-medium text-kumo-default">Nodes</span>
      </WorkflowBuilderPanelTitleBar>
      <div className="workflow-node-catalog-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <button
          type="button"
          onClick={onOpenGlobalVariables}
          className="group/menu-button flex min-h-11 w-full items-center gap-3 rounded-lg bg-kumo-base px-3 py-2 text-left text-sm font-medium text-kumo-default ring-1 ring-kumo-hairline transition-colors hover:bg-kumo-tint"
        >
          <KeyRound className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden />
          <span className="min-w-0 truncate">Global Variables</span>
        </button>

        <div className="mt-4 space-y-3">
          {GROUPED_WORKFLOW_NODE_CATALOG.map((group) => {
            const collapsed = collapsedCategories.has(group.category)
            const CategoryIcon = getWorkflowNodeCategoryIcon(group.category)

            return (
              <section key={group.category}>
                <button
                  type="button"
                  onClick={() => toggleCategory(group.category)}
                  aria-expanded={!collapsed}
                  className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium text-kumo-default transition-colors hover:bg-kumo-tint"
                >
                  {group.category === "slack" ? (
                    <SlackMarkIcon className="h-4 w-4 text-kumo-subtle" />
                  ) : (
                    <CategoryIcon className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {WORKFLOW_NODE_CATEGORY_LABELS[group.category]}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-kumo-subtle transition-transform duration-200 ${
                      collapsed ? "-rotate-90" : ""
                    }`}
                    aria-hidden
                  />
                </button>
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
                    collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="ml-5 space-y-1 border-l border-kumo-hairline py-1 pl-4">
                      {group.items.map((item) => (
                        <WorkflowNodeCatalogSubButton
                          key={item.id}
                          item={item}
                          dragged={draggedCatalogItemId === item.id}
                          onAddNode={onAddNode}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onPreview={onPreview}
                          onClearPreview={onClearPreview}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function WorkflowBuilderPanelTitleBar({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-kumo-hairline px-4">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">{children}</div>
      {action}
    </div>
  )
}

export function WorkflowBuilderPanelCollapseButton({
  title,
  onClick,
}: {
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-1.5 text-kumo-subtle ring-1 ring-kumo-hairline transition-colors hover:bg-kumo-tint hover:text-kumo-default"
      title={title}
    >
      <PanelLeftClose className="h-4 w-4" aria-hidden />
    </button>
  )
}
