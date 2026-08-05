import { Button } from "@cloudflare/kumo/components/button"
import { History, Play, Trash2 } from "lucide-react"
import { useState } from "react"
import { getWorkflowNodeDefinitionForNode, type WorkflowManifestNode } from "@solzero/shared"
import {
  PendingConnectionReplacement,
  PendingManualInputOverwrite,
  SlackTestTrigger,
  useDeleteConfirmationShortcut,
  WebhookTestPayload,
  WorkflowConnectionDetails,
  WorkflowRun,
  WorkflowSummary,
  WorkflowTemplateReferenceOption,
} from "./types"
import { WorkflowDialogFrame } from "./detail-chrome"
import { ConnectionEndpointCard, getPortById } from "./builder-canvas"
import { LabeledTextarea } from "./session-controls"
import {
  getManualInputValue,
  getNormalizedSourceHandle,
  getNormalizedTargetHandle,
} from "./manifest-utils"
import { defaultSlackTestTrigger, getErrorMessage, parseSlackTestTriggerInput } from "./run-utils"
import { formatJson, parseJsonInput, parseJsonRecord } from "./header-utils"

export function CelHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="xl"
      title="Common Expression Language"
      closeLabel="Close CEL help dialog"
      showCloseButton={false}
      bodyClassName="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4 text-sm leading-6 text-kumo-subtle"
      footer={
        <div className="flex justify-end px-5 py-4">
          <Button type="button" onClick={onClose} variant="ghost">
            Close
          </Button>
        </div>
      }
    >
      <p>
        CEL lets you write small, powerful expressions to inspect and transform your workflow data.
        You can combine variables and operators to express complex logic without writing a full
        program.
      </p>

      <CelHelpSection
        title="Access variables"
        items={[
          ["state.customer.tier", "global state stored across nodes"],
          ["input.results[0]", "values from the connected input"],
          ["workflow.runId", "current workflow run"],
        ]}
      />
      <CelHelpSection
        title="Perform comparisons"
        items={[
          ["input.score >= 0.8", null],
          ['state.customer.tier == "gold"', null],
          ["input.tags != null", null],
        ]}
      />
      <CelHelpSection
        title="Operators"
        items={[
          ["(input.score * 100) - 20", null],
          ["input.score > (state.flags.beta ? 0.9 : 0.8)", null],
          ['"The region is: " + input.metadata["region"]', null],
        ]}
      />
      <CelHelpSection
        title="Macros"
        items={[
          ["input.authors[size(input.authors) - 1]", null],
          ['"Patrick Starr" in state.employees', null],
          ['state.emails.all(email, email.contains("@"))', null],
        ]}
      />

      <p>
        Learn more at{" "}
        <a
          href="https://cel.dev/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 transition hover:text-kumo-default"
        >
          cel.dev
        </a>
        .
      </p>
    </WorkflowDialogFrame>
  )
}

export function CelHelpSection({
  title,
  items,
}: {
  title: string
  items: Array<[string, string | null]>
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-kumo-default">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {items.map(([expression, description]) => (
          <li key={expression} className="flex gap-2">
            <span aria-hidden>-</span>
            <span>
              <code className="bg-kumo-tint px-1.5 py-0.5 font-mono text-kumo-default">
                {expression}
              </code>
              {description ? <span> - {description}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DeleteNodeConfirmationModal({
  node,
  onCancel,
  onConfirm,
}: {
  node: WorkflowManifestNode
  onCancel: () => void
  onConfirm: () => void
}) {
  useDeleteConfirmationShortcut(onConfirm)

  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      title="Delete node?"
      description={`This will remove ${node.label} and any edges connected to it.`}
      showCloseButton={false}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            variant="secondary-destructive"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            Delete node
          </Button>
        </div>
      }
    />
  )
}

export function DeleteConnectionConfirmationModal({
  connection,
  onCancel,
  onConfirm,
}: {
  connection: WorkflowConnectionDetails
  onCancel: () => void
  onConfirm: () => void
}) {
  useDeleteConfirmationShortcut(onConfirm)

  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="lg"
      role="alertdialog"
      title="Delete connection?"
      description="This will remove the connector between these workflow ports."
      showCloseButton={false}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            variant="secondary-destructive"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            Delete connection
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <ConnectionEndpointCard
          node={connection.sourceNode}
          port={connection.sourcePort}
          handle={connection.sourceHandle}
          direction="Output"
        />
        <ConnectionEndpointCard
          node={connection.targetNode}
          port={connection.targetPort}
          handle={connection.targetHandle}
          direction="Input"
        />
      </div>
    </WorkflowDialogFrame>
  )
}

export function getEndpointLabel(
  nodes: WorkflowManifestNode[],
  nodeId: string | null | undefined,
  handle: string | null | undefined,
  direction: "source" | "target",
): string {
  const fallbackHandle =
    direction === "source" ? getNormalizedSourceHandle(handle) : getNormalizedTargetHandle(handle)
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) {
    return `${nodeId ?? "Unknown node"}.${fallbackHandle}`
  }

  const definition = getWorkflowNodeDefinitionForNode(node)
  const ports = direction === "source" ? definition.outputs : definition.inputs
  const port = getPortById(ports, fallbackHandle)
  return `${node.id}.${port?.id ?? fallbackHandle}`
}

export function ReplaceInputConnectionModal({
  replacement,
  nodes,
  onCancel,
  onConfirm,
}: {
  replacement: PendingConnectionReplacement
  nodes: WorkflowManifestNode[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const targetInput = getEndpointLabel(
    nodes,
    replacement.connection.target,
    replacement.connection.targetHandle,
    "target",
  )
  const currentOutput = getEndpointLabel(
    nodes,
    replacement.existingEdge.source,
    replacement.existingEdge.sourceHandle,
    "source",
  )
  const nextOutput = getEndpointLabel(
    nodes,
    replacement.connection.source,
    replacement.connection.sourceHandle,
    "source",
  )

  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      title="Replace input connection?"
      description={
        <>
          <span className="font-medium text-kumo-default">{targetInput}</span> is already connected
          to <span className="font-medium text-kumo-default">{currentOutput}</span>. Replace it with{" "}
          <span className="font-medium text-kumo-default">{nextOutput}</span>?
        </>
      }
      showCloseButton={false}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} variant="primary" className="text-white">
            Replace connection
          </Button>
        </div>
      }
    >
      <p className="text-xs leading-5 text-kumo-subtle">
        One output can still feed multiple inputs, but each input can only use one upstream output.
      </p>
    </WorkflowDialogFrame>
  )
}

export function OverwriteManualInputConnectionModal({
  overwrite,
  nodes,
  onCancel,
  onConfirm,
}: {
  overwrite: PendingManualInputOverwrite
  nodes: WorkflowManifestNode[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const targetInput = getEndpointLabel(
    nodes,
    overwrite.connection.target,
    overwrite.connection.targetHandle,
    "target",
  )
  const nextOutput = getEndpointLabel(
    nodes,
    overwrite.connection.source,
    overwrite.connection.sourceHandle,
    "source",
  )
  const manualValue = getManualInputValue(overwrite.targetNode, overwrite.targetHandle)

  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      title="Replace manual value?"
      description={
        <>
          <span className="font-medium text-kumo-default">{targetInput}</span> is manually set to{" "}
          <span className="font-mono text-kumo-default">{manualValue}</span>. Replace it with{" "}
          <span className="font-medium text-kumo-default">{nextOutput}</span>?
        </>
      }
      showCloseButton={false}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} variant="primary" className="text-white">
            Replace value
          </Button>
        </div>
      }
    />
  )
}

export function DeleteWorkflowConfirmationModal({
  workflow,
  deleting,
  onCancel,
  onConfirm,
}: {
  workflow: WorkflowSummary
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      title="Delete workflow?"
      description={`This will delete ${workflow.name} and remove it from the workflow list.`}
      showCloseButton={false}
      dismissible={!deleting}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} disabled={deleting} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            loading={deleting}
            variant="secondary-destructive"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            {deleting ? "Deleting" : "Delete workflow"}
          </Button>
        </div>
      }
    />
  )
}

export function DeleteRunConfirmationModal({
  run,
  deleting,
  onCancel,
  onConfirm,
}: {
  run: WorkflowRun
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <WorkflowDialogFrame
      open
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      title="Delete run?"
      description={
        <>
          This will remove run <span className="font-mono text-kumo-default">{run.id}</span> and its
          events from the workflow history.
        </>
      }
      showCloseButton={false}
      dismissible={!deleting}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button type="button" onClick={onCancel} disabled={deleting} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            loading={deleting}
            variant="secondary-destructive"
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
          >
            {deleting ? "Deleting" : "Delete run"}
          </Button>
        </div>
      }
    />
  )
}

export function SlackTestModal({
  node,
  running,
  recentTrigger,
  onClose,
  onRun,
}: {
  node: WorkflowManifestNode
  running: boolean
  recentTrigger: SlackTestTrigger | null
  onClose: () => void
  onRun: (trigger: SlackTestTrigger) => Promise<void>
}) {
  const [inputText, setInputText] = useState(() =>
    formatJson({ trigger: defaultSlackTestTrigger(node.id) }),
  )
  const [modalError, setModalError] = useState("")

  const reuseRecentInput = () => {
    if (!recentTrigger) {
      return
    }
    setInputText(formatJson({ trigger: recentTrigger }))
    setModalError("")
  }

  const submit = async () => {
    setModalError("")
    try {
      await onRun(parseSlackTestTriggerInput(inputText, node.id))
    } catch (errorValue) {
      setModalError(getErrorMessage(errorValue))
    }
  }

  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="xl"
      className="flex max-h-[85vh] w-full max-w-3xl flex-col p-0"
      title="Run Slack workflow"
      description="Slack input"
      closeLabel="Close Slack trigger test dialog"
      dismissible={!running}
      showCloseButton={false}
      bodyClassName="px-5 py-4"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button
            type="button"
            onClick={reuseRecentInput}
            disabled={!recentTrigger || running}
            variant="secondary"
            className="mr-auto"
            title={
              recentTrigger
                ? "Reuse input from the latest Slack run"
                : "No previous Slack run input"
            }
            icon={<History className="h-4 w-4" aria-hidden />}
          >
            Reuse last input
          </Button>
          <Button type="button" onClick={onClose} disabled={running} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={running}
            loading={running}
            variant="primary"
            className="text-white"
            icon={<Play className="h-4 w-4" aria-hidden />}
          >
            {running ? "Starting" : "Run test"}
          </Button>
        </div>
      }
    >
      <LabeledTextarea
        label="Slack input JSON"
        value={inputText}
        onChange={setInputText}
        mono
        rows={16}
      />
      {modalError ? (
        <div className="mt-3 rounded-lg bg-kumo-danger-tint/10 p-2 text-sm text-kumo-danger ring-1 ring-kumo-danger/30">
          {modalError}
        </div>
      ) : null}
    </WorkflowDialogFrame>
  )
}

export function WebhookTestModal({
  node,
  running,
  recentPayload,
  onClose,
  onRun,
}: {
  node: WorkflowManifestNode
  running: boolean
  recentPayload: WebhookTestPayload | null
  onClose: () => void
  onRun: (payload: WebhookTestPayload) => Promise<void>
}) {
  const [bodyText, setBodyText] = useState("{}")
  const [headersText, setHeadersText] = useState('{ "content-type": "application/json" }')
  const [queryText, setQueryText] = useState("{}")
  const [modalError, setModalError] = useState("")

  const reuseRecentPayload = () => {
    if (!recentPayload) {
      return
    }
    setBodyText(formatJson(recentPayload.body))
    setHeadersText(formatJson(recentPayload.headers))
    setQueryText(formatJson(recentPayload.query))
    setModalError("")
  }

  const submit = async () => {
    setModalError("")
    try {
      await onRun({
        body: parseJsonInput(bodyText, "Body"),
        headers: parseJsonRecord(headersText, "Headers"),
        query: parseJsonRecord(queryText, "Query"),
      })
    } catch (errorValue) {
      setModalError(getErrorMessage(errorValue))
    }
  }

  return (
    <WorkflowDialogFrame
      open
      onClose={onClose}
      size="lg"
      className="flex max-h-[85vh] w-full max-w-xl flex-col p-0"
      title="Test webhook"
      description={node.label}
      closeLabel="Close webhook test dialog"
      dismissible={!running}
      showCloseButton={false}
      bodyClassName="px-5 py-4"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <Button
            type="button"
            onClick={reuseRecentPayload}
            disabled={!recentPayload || running}
            variant="secondary"
            className="mr-auto"
            title={
              recentPayload
                ? "Reuse payload from the most recent webhook run"
                : "No previous webhook run payload"
            }
            icon={<History className="h-4 w-4" aria-hidden />}
          >
            Reuse last payload
          </Button>
          <Button type="button" onClick={onClose} disabled={running} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={running}
            loading={running}
            variant="primary"
            className="text-white"
            icon={<Play className="h-4 w-4" aria-hidden />}
          >
            {running ? "Starting" : "Run test"}
          </Button>
        </div>
      }
    >
      <LabeledTextarea label="Body JSON" value={bodyText} onChange={setBodyText} mono />
      <LabeledTextarea label="Headers JSON" value={headersText} onChange={setHeadersText} mono />
      <LabeledTextarea label="Query JSON" value={queryText} onChange={setQueryText} mono />
      {modalError ? (
        <div className="mt-3 rounded-lg bg-kumo-danger-tint/10 p-2 text-sm text-kumo-danger ring-1 ring-kumo-danger/30">
          {modalError}
        </div>
      ) : null}
    </WorkflowDialogFrame>
  )
}

export function WorkflowTemplateReferenceDescription({
  options,
}: {
  options: WorkflowTemplateReferenceOption[]
}) {
  if (options.length === 0) {
    return null
  }

  const handles = options.map((option) => option.handle).join(", ")

  return (
    <p className="mt-1.5 text-xs leading-5 text-kumo-subtle">
      Connected input ports available here:{" "}
      <span className="font-mono text-kumo-default">{handles}</span>. Reference one with{" "}
      <span className="font-mono text-kumo-default">{`{{inputs.<port>}}`}</span>.
    </p>
  )
}
