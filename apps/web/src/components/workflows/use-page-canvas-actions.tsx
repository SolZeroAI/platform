// @ts-nocheck
import { addEdge, type Connection, type OnEdgesChange } from "@xyflow/react"
import { useCallback } from "react"
import {
  getWorkflowNodeDefaultOptions,
  getWorkflowNodeDefinition,
  type WorkflowManifestNode,
  type WorkflowNodeType,
} from "@c0-agent/shared"
import { WorkflowCanvasEdge } from "./types"
import {
  clearManualInputValue,
  findEdgeUsingTargetInput,
  getConnectionTargetInputKey,
  getEdgeTargetInputKey,
  getNormalizedTargetHandle,
  hasManualInputValue,
  isSameConnection,
  toCanvasNode,
  toConnectionEdge,
} from "./manifest-utils"

export function useWorkflowPageCanvasActions(input: any) {
  const {
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
  } = input

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return
      }

      const existingEdge = findEdgeUsingTargetInput(edges, connection)
      if (existingEdge) {
        if (!isSameConnection(existingEdge, connection)) {
          setConnectionPendingReplacement({ connection, existingEdge })
        }
        return
      }

      const targetNode = nodes.find((node) => node.id === connection.target)?.data.node
      const targetHandle = getNormalizedTargetHandle(connection.targetHandle)
      if (targetNode && hasManualInputValue(targetNode, targetHandle)) {
        setConnectionPendingManualOverwrite({ connection, targetNode, targetHandle })
        return
      }

      setEdges((current) => addEdge(toConnectionEdge(connection), current))
      setSelectedEdgeId(null)
    },
    [edges, nodes, setEdges],
  )

  const confirmConnectionReplacement = useCallback(() => {
    if (!connectionPendingReplacement) {
      return
    }

    setEdges((current) =>
      addEdge(
        toConnectionEdge(connectionPendingReplacement.connection),
        current.filter(
          (edge) =>
            getEdgeTargetInputKey(edge) !==
            getConnectionTargetInputKey(connectionPendingReplacement.connection),
        ),
      ),
    )
    setNodes((current) =>
      current.map((node) =>
        node.id === connectionPendingReplacement.connection.target
          ? {
              ...node,
              data: {
                node: clearManualInputValue(
                  node.data.node,
                  getNormalizedTargetHandle(connectionPendingReplacement.connection.targetHandle),
                ),
              },
            }
          : node,
      ),
    )
    setConnectionPendingReplacement(null)
    setSelectedEdgeId(null)
  }, [connectionPendingReplacement, setEdges, setNodes])

  const confirmManualInputOverwrite = useCallback(() => {
    if (!connectionPendingManualOverwrite) {
      return
    }

    const { connection, targetHandle } = connectionPendingManualOverwrite
    setNodes((current) =>
      current.map((node) =>
        node.id === connection.target
          ? { ...node, data: { node: clearManualInputValue(node.data.node, targetHandle) } }
          : node,
      ),
    )
    setEdges((current) =>
      addEdge(
        toConnectionEdge(connection),
        current.filter(
          (edge) => getEdgeTargetInputKey(edge) !== getConnectionTargetInputKey(connection),
        ),
      ),
    )
    setConnectionPendingManualOverwrite(null)
    setSelectedEdgeId(null)
  }, [connectionPendingManualOverwrite, setEdges, setNodes])

  const addNode = useCallback(
    (type: WorkflowNodeType, position?: WorkflowManifestNode["position"]) => {
      const definition = getWorkflowNodeDefinition(type)
      const id = `${type}-${Date.now().toString(36)}`
      const nodePosition = position ?? { x: 180 + nodes.length * 28, y: 120 + nodes.length * 24 }
      const node: WorkflowManifestNode = {
        id,
        type,
        label: definition.label,
        position: nodePosition,
        options: getWorkflowNodeDefaultOptions(type),
      }
      setNodes((current) => [...current, toCanvasNode(node)])
      setSelectedNodeId(id)
      setSelectedEdgeId(null)
      setDetailsCollapsed(false)
    },
    [nodes.length, setNodes],
  )

  const selectCanvasNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
    setDetailsCollapsed(false)
  }, [])

  const selectCanvasEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
    setDetailsCollapsed(false)
  }, [])

  const clearCanvasNodeSelection = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setDetailsCollapsed(true)
  }, [])

  const openNodeCatalog = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setNodePickerCollapsed(false)
    setDetailsCollapsed(true)
  }, [])

  const updateSelectedNode = useCallback(
    (updater: (node: WorkflowManifestNode) => WorkflowManifestNode) => {
      if (!selectedNodeId) {
        return
      }
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId ? { ...node, data: { node: updater(node.data.node) } } : node,
        ),
      )
    },
    [selectedNodeId, setNodes],
  )

  const renameSelectedNode = useCallback(
    (nextNodeId: string) => {
      const trimmedNodeId = nextNodeId.trim()
      if (!selectedNodeId || !trimmedNodeId) {
        return false
      }
      if (trimmedNodeId === selectedNodeId) {
        return true
      }
      if (nodes.some((node) => node.id === trimmedNodeId)) {
        return false
      }

      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                id: trimmedNodeId,
                data: { node: { ...node.data.node, id: trimmedNodeId } },
              }
            : node,
        ),
      )
      setEdges((current) =>
        current.map((edge) => ({
          ...edge,
          source: edge.source === selectedNodeId ? trimmedNodeId : edge.source,
          target: edge.target === selectedNodeId ? trimmedNodeId : edge.target,
        })),
      )
      setSelectedNodeId(trimmedNodeId)
      setWebhookTestNode((current) =>
        current?.id === selectedNodeId ? { ...current, id: trimmedNodeId } : current,
      )
      setNodePendingDeletion((current) =>
        current?.id === selectedNodeId ? { ...current, id: trimmedNodeId } : current,
      )
      setWorkflowHeaderDraftsByNode((current) => {
        const selectedNodeDraftRows = current[selectedNodeId]
        if (!selectedNodeDraftRows) {
          return current
        }
        const next = { ...current }
        delete next[selectedNodeId]
        next[trimmedNodeId] = selectedNodeDraftRows
        return next
      })
      return true
    },
    [nodes, selectedNodeId, setEdges, setNodes],
  )

  const renameSelectedNodeInputHandle = useCallback(
    (previousHandle: string, nextHandle: string) => {
      if (!selectedNodeId || previousHandle === nextHandle) {
        return
      }

      setEdges((current) =>
        current.map((edge) =>
          edge.target === selectedNodeId &&
          getNormalizedTargetHandle(edge.targetHandle) === previousHandle
            ? { ...edge, targetHandle: nextHandle }
            : edge,
        ),
      )
    },
    [selectedNodeId, setEdges],
  )

  const removeSelectedNodeInputHandle = useCallback(
    (handle: string) => {
      if (!selectedNodeId) {
        return
      }

      setEdges((current) =>
        current.filter(
          (edge) =>
            edge.target !== selectedNodeId ||
            getNormalizedTargetHandle(edge.targetHandle) !== handle,
        ),
      )
    },
    [selectedNodeId, setEdges],
  )

  const deleteNode = useCallback(
    (nodeId: string) => {
      const deletedEdgeIds = new Set(
        edges
          .filter((edge) => edge.source === nodeId || edge.target === nodeId)
          .map((edge) => edge.id),
      )
      setNodes((current) => current.filter((node) => node.id !== nodeId))
      setEdges((current) =>
        current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      )
      setSelectedNodeId((current) => (current === nodeId ? null : current))
      setSelectedEdgeId((selectedId) => {
        if (!selectedId) {
          return null
        }
        return deletedEdgeIds.has(selectedId) ? null : selectedId
      })
      if (selectedNodeId === nodeId) {
        setDetailsCollapsed(true)
      }
      setWebhookTestNode((current) => (current?.id === nodeId ? null : current))
      setWorkflowHeaderDraftsByNode((current) => {
        if (!current[nodeId]) {
          return current
        }
        const next = { ...current }
        delete next[nodeId]
        return next
      })
      setNodePendingDeletion(null)
    },
    [edges, selectedNodeId, setEdges, setNodes],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((current) => current.filter((edge) => edge.id !== edgeId))
      setSelectedEdgeId((current) => (current === edgeId ? null : current))
      setEdgePendingDeletionId((current) => (current === edgeId ? null : current))
      if (selectedEdgeId === edgeId) {
        setDetailsCollapsed(true)
      }
    },
    [selectedEdgeId, setEdges],
  )

  const handleEdgesChange = useCallback<OnEdgesChange<WorkflowCanvasEdge>>(
    (changes) => {
      if (
        selectedEdgeId &&
        changes.some((change) => change.type === "remove" && change.id === selectedEdgeId)
      ) {
        setSelectedEdgeId(null)
        setDetailsCollapsed(true)
      }
      onEdgesChange(changes)
    },
    [onEdgesChange, selectedEdgeId],
  )

  return {
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
  }
}
