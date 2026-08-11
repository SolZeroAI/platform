import { Input } from "@cloudflare/kumo/components/input"
import { Label } from "@cloudflare/kumo/components/label"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { Select } from "@cloudflare/kumo/components/select"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import {
  type Connection,
  Handle,
  type NodeProps,
  Position,
  useUpdateNodeInternals,
} from "@xyflow/react"
import { Link } from "@tanstack/react-router"
import { Copy, GitBranch, Save, Trash2, X } from "lucide-react"
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react"
import {
  getWorkflowNodeDefinitionForNode,
  type WorkflowManifestNode,
  type WorkflowNodeDefinition,
  type WorkflowPortDefinition,
} from "@solzero/shared"
import { filterSecretsByTags, SecretTagFilter } from "@/components/secret-selector"
import { useSecrets } from "@/hooks/use-secrets"
import { copyToClipboard } from "@/lib/format"
import {
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowConnectionDetails,
  WorkflowTemplateReferenceOption,
} from "./types"
import { WorkflowDialogFrame } from "./detail-chrome"
import { NodeCategoryIcon, WorkflowNodeCatalogOptionIcon } from "./session-controls"
import {
  getManualInputValue,
  getNormalizedSourceHandle,
  getNormalizedTargetHandle,
  hasManualInputValue,
} from "./manifest-utils"

export function GlobalVariablesModal({
  workflowId,
  runId,
  userId,
  onClose,
}: {
  workflowId: string | null
  runId: string | null
  userId: string | null
  onClose: () => void
}) {
  const variables = [
    {
      key: "{{workflowId}}",
      value: workflowId ?? "Save workflow first",
      muted: workflowId === null,
    },
    {
      key: "{{runId}}",
      value: runId ?? "Resolved at runtime",
      muted: runId === null,
      italic: runId === null,
    },
    {
      key: "{{nodeId}}",
      value: "Varies",
      muted: true,
      italic: true,
    },
    {
      key: "{{userId}}",
      value: userId ?? "Current user",
      muted: userId === null,
    },
    {
      key: "{{oktaUserId}}",
      value: "Resolved at runtime",
      muted: true,
      italic: true,
    },
  ]

  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="lg"
      title="Global Variables"
      description="These template keys are available to workflow nodes during execution."
      closeLabel="Close global variables dialog"
      bodyClassName="px-5 py-4"
    >
      <div className="overflow-hidden rounded-xl bg-kumo-elevated/80">
        <KumoTable layout="fixed" className="w-full text-left text-xs">
          <KumoTable.Header className="bg-kumo-tint text-kumo-default">
            <KumoTable.Row>
              <KumoTable.Head className="w-1/2 bg-kumo-tint px-2 py-1.5 font-medium">
                Template Key
              </KumoTable.Head>
              <KumoTable.Head className="w-1/2 bg-kumo-tint px-2 py-1.5 font-medium">
                Rendered Value
              </KumoTable.Head>
            </KumoTable.Row>
          </KumoTable.Header>
          <KumoTable.Body>
            {variables.map((variable) => (
              <KumoTable.Row key={variable.key} className="bg-kumo-base">
                <KumoTable.Cell className="truncate border-b border-kumo-hairline px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                  {variable.key}
                </KumoTable.Cell>
                <KumoTable.Cell
                  className={`truncate border-b border-kumo-hairline px-2 py-1.5 font-mono text-[11px] ${
                    variable.muted ? "text-kumo-subtle" : "text-kumo-default"
                  } ${variable.italic ? "italic" : ""}`}
                >
                  {variable.value}
                </KumoTable.Cell>
              </KumoTable.Row>
            ))}
          </KumoTable.Body>
        </KumoTable>
      </div>
    </WorkflowDialogFrame>
  )
}

export function WorkflowCanvasNodeView({ data, selected }: NodeProps<WorkflowCanvasNode>) {
  const definition = getWorkflowNodeDefinitionForNode(data.node)
  const updateNodeInternals = useUpdateNodeInternals()
  const inputHandleSignature = definition.inputs.map((port) => port.id).join("\u0000")
  const outputHandleSignature = definition.outputs.map((port) => port.id).join("\u0000")
  const handleSignature = `${inputHandleSignature}\u0001${outputHandleSignature}`
  const [now, setNow] = useState(() => Date.now())
  const triggerWaitLabel = getTriggerWaitLabel(data.node, now)
  const triggerStatus = data.workflowDisabled && triggerWaitLabel ? "Disabled" : triggerWaitLabel
  const triggerStatusClassName = data.workflowDisabled
    ? "workflow-status-red"
    : "workflow-status-emerald"
  const triggerStatusDotClassName = data.workflowDisabled
    ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]"
    : "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
  const nodeRingClassName = data.hasValidationErrors
    ? "ring-red-400 shadow-[0_0_0_1px_rgba(248,113,113,0.6)]"
    : selected
      ? "ring-sky-400"
      : "ring-kumo-line"

  useEffect(() => {
    if (data.node.type !== "datetime-trigger") {
      return
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => window.clearInterval(intervalId)
  }, [data.node.type])

  useLayoutEffect(() => {
    updateNodeInternals(data.node.id)
  }, [data.node.id, handleSignature, updateNodeInternals])

  return (
    <LayerCard className={`relative min-w-48 w-auto overflow-visible ${nodeRingClassName}`}>
      <LayerCard.Secondary className="my-0 flex items-center gap-2 rounded-t-lg px-3 py-2">
        <WorkflowNodeCatalogOptionIcon type={data.node.type} category={definition.category} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-kumo-default">{data.node.label}</div>
        </div>
      </LayerCard.Secondary>
      <LayerCard.Primary className="gap-0 overflow-visible rounded-lg bg-kumo-base px-3 py-2 pr-3 text-xs text-kumo-subtle">
        {definition.inputs.length > 0 ? (
          <div className="mb-2 space-y-1">
            <div className="text-[10px] font-medium text-kumo-subtle">Inputs</div>
            {definition.inputs.map((port) => {
              const manualInput = hasManualInputValue(data.node, port.id)
              return (
                <div key={port.id} className="relative -ml-3 flex min-h-6 items-center gap-2 pl-3">
                  <Handle
                    id={port.id}
                    type="target"
                    position={Position.Left}
                    className={`!top-1/2 !-left-[4px] !h-2 !w-2 !-translate-y-1/2 ${
                      manualInput ? "!border-sky-400 !bg-sky-500/10" : ""
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{port.id}</span>
                </div>
              )
            })}
          </div>
        ) : null}
        {definition.outputs.length > 0 ? (
          <div className="space-y-1 text-right">
            <div className="text-[10px] font-medium text-kumo-subtle">Outputs</div>
            {definition.outputs.map((port) => (
              <div
                key={port.id}
                className="relative -mr-3 flex min-h-6 items-center justify-between gap-2 pr-3"
              >
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px]">
                  {port.id}
                </span>
                <Handle
                  id={port.id}
                  type="source"
                  position={Position.Right}
                  className="!top-1/2 !-right-[4px] !h-2 !w-2 !-translate-y-1/2"
                />
              </div>
            ))}
          </div>
        ) : null}
      </LayerCard.Primary>
      {triggerStatus ? (
        <LayerCard.Secondary
          className={`my-0 flex items-center gap-2 rounded-b-lg px-3 py-2 text-[10px] font-medium leading-none ${triggerStatusClassName}`}
        >
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${triggerStatusDotClassName}`}
            aria-hidden
          />
          <span>{triggerStatus}</span>
        </LayerCard.Secondary>
      ) : null}
    </LayerCard>
  )
}

export function getTriggerWaitLabel(node: WorkflowManifestNode, now: number): string | null {
  if (node.type === "webhook-trigger") {
    return "Listening for requests"
  }
  if (node.type === "manual-trigger") {
    return "Ready to run manually"
  }
  if (node.type === "datetime-trigger") {
    const scheduledAt = typeof node.options.scheduledAt === "string" ? node.options.scheduledAt : ""
    const scheduledAtMs = Date.parse(scheduledAt)
    if (!Number.isFinite(scheduledAtMs)) {
      return "Waiting for schedule"
    }
    const durationMs = scheduledAtMs - now
    if (durationMs <= 0) {
      return "Executing now"
    }
    return `Executing in ${formatHumanDuration(durationMs)}`
  }
  if (node.type === "cron-trigger") {
    const cron = typeof node.options.cron === "string" ? node.options.cron.trim() : ""
    return cron ? `Scheduled by ${cron}` : "Waiting for cron schedule"
  }
  return null
}

export function formatHumanDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60_000)
  if (totalMinutes < 1) {
    return "less than a minute"
  }

  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  const parts = [
    formatDurationPart(days, "day"),
    formatDurationPart(hours, "hour"),
    formatDurationPart(minutes, "minute"),
  ].filter((part) => part !== null)

  return parts.slice(0, 2).join(" ")
}

export function formatDurationPart(value: number, label: string): string | null {
  if (value === 0) {
    return null
  }
  return `${value} ${label}${value === 1 ? "" : "s"}`
}

export function getPortById(ports: readonly WorkflowPortDefinition[], id: string) {
  return ports.find((port) => port.id === id) ?? null
}

export function getWorkflowConnectionDetails(
  edge: WorkflowCanvasEdge | null,
  nodes: WorkflowCanvasNode[],
): WorkflowConnectionDetails | null {
  if (!edge) {
    return null
  }

  const sourceNode = nodes.find((node) => node.id === edge.source)?.data.node
  const targetNode = nodes.find((node) => node.id === edge.target)?.data.node
  if (!sourceNode || !targetNode) {
    return null
  }

  const sourceDefinition = getWorkflowNodeDefinitionForNode(sourceNode)
  const targetDefinition = getWorkflowNodeDefinitionForNode(targetNode)
  const sourceHandle = getNormalizedSourceHandle(edge.sourceHandle)
  const targetHandle = getNormalizedTargetHandle(edge.targetHandle)

  return {
    edge,
    sourceNode,
    targetNode,
    sourcePort: getPortById(sourceDefinition.outputs, sourceHandle),
    targetPort: getPortById(targetDefinition.inputs, targetHandle),
    sourceHandle,
    targetHandle,
  }
}

export function getConnectedInputTemplates(
  node: WorkflowManifestNode,
  nodes: WorkflowCanvasNode[],
  edges: WorkflowCanvasEdge[],
): WorkflowTemplateReferenceOption[] {
  const nodeById = new Map(nodes.map((canvasNode) => [canvasNode.id, canvasNode.data.node]))

  return edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => {
      const sourceNode = nodeById.get(edge.source)
      if (!sourceNode) {
        return null
      }

      const targetHandle = getNormalizedTargetHandle(edge.targetHandle)

      return {
        id: `${edge.id}:${targetHandle}`,
        handle: targetHandle,
      }
    })
    .filter((option): option is WorkflowTemplateReferenceOption => option !== null)
}

export function getConnectedInputByHandle(
  node: WorkflowManifestNode,
  nodes: WorkflowManifestNode[],
  edges: WorkflowCanvasEdge[],
) {
  const nodeById = new Map(nodes.map((item) => [item.id, item]))
  const connectedInputs = new Map<
    string,
    {
      sourceHandle: string
      sourceNode: WorkflowManifestNode
      sourcePort: WorkflowPortDefinition | null
    }
  >()

  for (const edge of edges) {
    if (edge.target !== node.id) {
      continue
    }

    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode) {
      continue
    }

    const sourceDefinition = getWorkflowNodeDefinitionForNode(sourceNode)
    const sourceHandle = edge.sourceHandle ?? "result"
    const sourcePort = getPortById(sourceDefinition.outputs, sourceHandle)
    connectedInputs.set(edge.targetHandle ?? "input", { sourceHandle, sourceNode, sourcePort })
  }

  return connectedInputs
}

export function NodeInputsPanel({
  node,
  definition,
  edges,
  nodes,
  onChangeManualInput,
  onDisconnectInput,
}: {
  node: WorkflowManifestNode
  definition: WorkflowNodeDefinition
  edges: WorkflowCanvasEdge[]
  nodes: WorkflowManifestNode[]
  onChangeManualInput: (handle: string, value: string) => void
  onDisconnectInput: (handle: string) => void
}) {
  const connectedInputByHandle = getConnectedInputByHandle(node, nodes, edges)
  const { secrets, tags: secretTags, loading: loadingSecrets } = useSecrets()
  const [selectedSecretTags, setSelectedSecretTags] = useState<string[]>([])
  const visibleSecrets = useMemo(
    () => filterSecretsByTags(secrets, selectedSecretTags),
    [secrets, selectedSecretTags],
  )

  if (definition.inputs.length === 0) {
    return <div className="text-xs text-kumo-subtle">No inputs</div>
  }

  return (
    <div className="space-y-2">
      {definition.inputs.map((port) => {
        const connectedInput = connectedInputByHandle.get(port.id)
        const source = connectedInput
          ? `${connectedInput.sourceNode.id}.${
              connectedInput.sourcePort?.id ?? connectedInput.sourceHandle
            }`
          : null
        const inputId = `${node.id}-${port.id}-input`
        const inputTitle = `inputs.${port.id}`
        const copyInputTitle = (event: MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault()
          event.stopPropagation()
          void copyToClipboard(inputTitle)
        }

        return (
          <div key={port.id}>
            <div className="group">
              <button
                type="button"
                onClick={copyInputTitle}
                className="flex min-h-7 max-w-full items-center gap-1.5 font-mono text-[11px] text-kumo-default transition-[color,text-decoration-color,transform] hover:text-kumo-brand hover:underline hover:underline-offset-2 group-hover:text-kumo-brand group-hover:underline group-hover:underline-offset-2 active:scale-[0.96]"
                title={`Copy ${inputTitle}`}
                aria-label={`Copy ${inputTitle}`}
              >
                <span className="min-w-0 truncate">{inputTitle}</span>
                <Copy
                  className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-hidden
                />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {node.type === "get-secret" && port.id === "key" && !source ? (
                <select
                  id={inputId}
                  aria-label={inputTitle}
                  value={getManualInputValue(node, port.id)}
                  onChange={(event) => onChangeManualInput(port.id, event.target.value)}
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-kumo-hairline bg-kumo-tint px-2 py-1.5 font-mono text-[11px] text-kumo-default outline-none focus:ring-2 focus:ring-kumo-focus"
                >
                  <option value="">
                    {loadingSecrets ? "Loading secrets..." : "Select a secret"}
                  </option>
                  {visibleSecrets.map((secret) => (
                    <option key={secret.key} value={secret.key}>
                      {secret.key}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  aria-label={inputTitle}
                  value={source ?? getManualInputValue(node, port.id)}
                  disabled={Boolean(source)}
                  onChange={(event) => onChangeManualInput(port.id, event.target.value)}
                  className={`min-h-10 min-w-0 flex-1 rounded-lg border border-kumo-hairline bg-kumo-tint px-2 py-1.5 font-mono text-[11px] outline-none focus:ring-2 focus:ring-kumo-focus disabled:cursor-not-allowed ${
                    source ? "text-kumo-subtle" : "text-kumo-default"
                  }`}
                  placeholder="Connect a node or type a value"
                />
              )}
              {source ? (
                <button
                  type="button"
                  onClick={() => onDisconnectInput(port.id)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-kumo-line text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96]"
                  title="Disconnect input"
                  aria-label={`Disconnect inputs.${port.id}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
            {node.type === "get-secret" && port.id === "key" ? (
              <div className="mt-2 space-y-2">
                <SecretTagFilter
                  tags={secretTags}
                  selectedTags={selectedSecretTags}
                  onChange={setSelectedSecretTags}
                />
                <p className="text-xs leading-5 text-kumo-subtle">
                  Store and change secrets in your{" "}
                  <Link
                    to="/settings"
                    search={{ category: "secrets" }}
                    className="text-kumo-brand underline underline-offset-2 transition hover:text-kumo-default"
                  >
                    user profile settings
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function NodeOutputsPanel({ definition }: { definition: WorkflowNodeDefinition }) {
  if (definition.outputs.length === 0) {
    return <div className="text-xs text-kumo-subtle">No outputs</div>
  }

  return (
    <div className="mt-3">
      <Label className="mb-1.5 flex">Outputs</Label>
      <table className="w-full table-fixed overflow-hidden rounded-xl border-collapse bg-kumo-elevated/80 text-left text-xs">
        <thead className="border-b border-kumo-line bg-kumo-tint text-kumo-default">
          <tr>
            <th className="w-1/2 px-2 py-1.5 font-medium">Key</th>
            <th className="w-1/2 px-2 py-1.5 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {definition.outputs.map((port) => (
            <tr key={port.id} className="border-t border-kumo-line first:border-t-0">
              <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                {port.id}
              </td>
              <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                {port.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CatalogPortPreview({ definition }: { definition: WorkflowNodeDefinition }) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-kumo-brand">{definition.description}</p>
      <CatalogPortTable title="Inputs" ports={definition.inputs} emptyLabel="No inputs" />
      <CatalogPortTable title="Outputs" ports={definition.outputs} emptyLabel="No outputs" />
    </div>
  )
}

export function CatalogPortTable({
  title,
  ports,
  emptyLabel,
}: {
  title: string
  ports: WorkflowNodeDefinition["inputs"]
  emptyLabel: string
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium uppercase text-kumo-subtle">{title}</div>
      {ports.length > 0 ? (
        <table className="w-full table-fixed overflow-hidden rounded-xl border-collapse bg-kumo-elevated/80 text-left text-xs">
          <thead className="border-b border-kumo-line bg-kumo-tint text-kumo-default">
            <tr>
              <th className="w-1/2 px-2 py-1.5 font-medium">Key</th>
              <th className="w-1/2 px-2 py-1.5 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port) => (
              <tr key={port.id} className="border-t border-kumo-line first:border-t-0">
                <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                  {port.id}
                </td>
                <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                  {port.type}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="rounded-lg border border-kumo-line bg-kumo-tint px-2 py-1.5 text-xs text-kumo-subtle">
          {emptyLabel}
        </div>
      )}
    </div>
  )
}

export function ConnectionInspector({
  connection,
  onDelete,
  panelAction,
}: {
  connection: WorkflowConnectionDetails
  onDelete: () => void
  panelAction?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
            <div className="min-w-0">
              <div className="text-sm font-medium text-kumo-default">Connection</div>
              <div className="text-xs text-kumo-subtle">Review the linked output and input.</div>
            </div>
          </div>
          {panelAction}
        </div>

        <div className="space-y-2 pt-1">
          <ConnectionEndpointCard
            node={connection.sourceNode}
            port={connection.sourcePort}
            handle={connection.sourceHandle}
            direction="Output"
          />

          <div className="flex flex-col items-center">
            <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-kumo-subtle">
              Source
            </span>
            <span className="workflow-connection-dash my-1.5 h-8 w-px" aria-hidden />
            <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-kumo-subtle">
              Destination
            </span>
          </div>

          <ConnectionEndpointCard
            node={connection.targetNode}
            port={connection.targetPort}
            handle={connection.targetHandle}
            direction="Input"
          />
        </div>
      </div>

      <div className="border-t border-kumo-hairline p-4">
        <button
          type="button"
          onClick={onDelete}
          className="kumo-btn-destructive min-h-10 active:scale-[0.96]"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete connection
        </button>
      </div>
    </div>
  )
}

export function ConnectionEndpointCard({
  node,
  port,
  handle,
  direction,
}: {
  node: WorkflowManifestNode
  port: WorkflowPortDefinition | null
  handle: string
  direction: "Input" | "Output"
}) {
  const definition = getWorkflowNodeDefinitionForNode(node)

  return (
    <section className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
      <div className="flex min-h-10 items-center gap-2 border-b border-kumo-hairline px-3 py-2">
        <NodeCategoryIcon type={node.type} category={definition.category} className="h-7 w-7" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-kumo-default">{node.label}</div>
          <div className="truncate font-mono text-[11px] text-kumo-subtle">{node.id}</div>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="mb-1.5 text-xs font-medium uppercase text-kumo-subtle">{direction}</div>
        <table className="w-full table-fixed overflow-hidden rounded-xl border-collapse bg-kumo-elevated/80 text-left text-xs">
          <thead className="border-b border-kumo-line bg-kumo-tint text-kumo-default">
            <tr>
              <th className="w-1/2 px-2 py-1.5 font-medium">Key</th>
              <th className="w-1/2 px-2 py-1.5 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                {handle}
              </td>
              <td className="truncate px-2 py-1.5 font-mono text-[11px] text-kumo-default">
                {port?.type ?? "any"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
