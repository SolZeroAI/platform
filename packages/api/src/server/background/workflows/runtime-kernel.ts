import {
  isWorkflowTriggerNodeType,
  type WorkflowManifest,
  type WorkflowManifestNode,
  type WorkflowNodeType,
} from "@solzero/shared"

export const WORKFLOW_RUNTIME_KERNEL_V1_MODULE_NAME = "workflow-runtime-kernel.v1.js"
export const WORKFLOW_RUNTIME_KERNEL_V2_MODULE_NAME = "workflow-runtime-kernel.v2.js"
export const WORKFLOW_RUNTIME_KERNEL_MODULE_NAME = WORKFLOW_RUNTIME_KERNEL_V2_MODULE_NAME

export interface WorkflowRuntimeTriggerPayload {
  kind?: string | null
  nodeId?: string | null
  payload?: Record<string, unknown> | null
  cron?: string | null
  scheduledAt?: string | null
  firedAt?: string | null
}

export type WorkflowNodeOutputs = Record<string, unknown>
export type WorkflowRuntimeOutputs = Record<string, WorkflowNodeOutputs>

export interface WorkflowActionResult {
  outputs?: WorkflowNodeOutputs
  [key: string]: unknown
}

export interface WorkflowRuntimeKernel {
  createInitialOutputs(
    trigger: WorkflowRuntimeTriggerPayload | null | undefined,
    eventTimestamp: string | null,
  ): WorkflowRuntimeOutputs
  collectInputs(nodeId: string, outputs: WorkflowRuntimeOutputs): Record<string, unknown>
  shouldRunNode(
    nodeId: string,
    outputs: WorkflowRuntimeOutputs,
    skippedNodeIds: Set<string>,
  ): boolean
  redactInputsForEvent(nodeId: string, inputs: Record<string, unknown>): Record<string, unknown>
  redactActionResultForEvent(
    node: WorkflowManifestNode,
    result: WorkflowActionResult | unknown,
  ): WorkflowActionResult | unknown
  redactWorkflowOutputsForEvent(outputs: WorkflowRuntimeOutputs): WorkflowRuntimeOutputs
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function cloneRecord(record: unknown): Record<string, unknown> {
  return { ...recordFromUnknown(record) }
}

function redactSecretValue(value: unknown): unknown {
  return value === null || value === undefined ? value : "[redacted]"
}

export function normalizeActionResult(result: unknown): WorkflowActionResult {
  const record = recordFromUnknown(result)
  if (record && "outputs" in record) {
    return record as WorkflowActionResult
  }
  return { outputs: { result } }
}

function getTriggerNodeType(kind: unknown): WorkflowNodeType {
  if (kind === "webhook") return "webhook-trigger"
  if (kind === "datetime") return "datetime-trigger"
  if (kind === "cron") return "cron-trigger"
  if (kind === "slack") return "slack-trigger"
  return "manual-trigger"
}

function isActiveTriggerNode(
  node: WorkflowManifestNode,
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
): boolean {
  if (node.type !== getTriggerNodeType(trigger?.kind)) {
    return false
  }
  return typeof trigger?.nodeId === "string" && trigger.nodeId ? node.id === trigger.nodeId : true
}

function getTriggerOutputs(
  node: WorkflowManifestNode,
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
  eventTimestamp: string | null,
): WorkflowNodeOutputs {
  if (node.type === "manual-trigger") {
    return {
      payload: trigger?.payload ?? {},
    }
  }
  if (node.type === "webhook-trigger") {
    const payload = recordFromUnknown(trigger?.payload) ?? {}
    return {
      body: payload.body ?? trigger?.payload ?? null,
      headers: payload.headers ?? {},
      query: payload.query ?? {},
    }
  }
  if (node.type === "datetime-trigger") {
    return {
      scheduledAt: trigger?.scheduledAt ?? node.options.scheduledAt ?? null,
      firedAt: trigger?.firedAt ?? eventTimestamp,
    }
  }
  if (node.type === "cron-trigger") {
    return {
      cron: trigger?.cron ?? node.options.cron ?? null,
      scheduledAt: trigger?.scheduledAt ?? null,
      firedAt: trigger?.firedAt ?? eventTimestamp,
    }
  }
  if (node.type === "slack-trigger") {
    const payload = recordFromUnknown(trigger?.payload) ?? {}
    return {
      teamId: payload.teamId ?? null,
      channelId: payload.channelId ?? null,
      channelName: payload.channelName ?? null,
      userId: payload.userId ?? null,
      text: payload.text ?? "",
      eventType: payload.eventType ?? null,
      command: payload.command ?? null,
      messageTs: payload.messageTs ?? null,
      threadTs: payload.threadTs ?? payload.messageTs ?? null,
      triggerId: payload.triggerId ?? null,
      actionId: payload.actionId ?? null,
      responseUrl: payload.responseUrl ?? null,
      rawPayload: recordFromUnknown(payload.rawPayload) ?? payload,
    }
  }
  return {}
}

function getManualInputValues(node: WorkflowManifestNode | undefined): Record<string, unknown> {
  return cloneRecord(node?.options.inputValues)
}

export function createWorkflowRuntimeKernel(manifest: WorkflowManifest): WorkflowRuntimeKernel {
  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]))

  function getSecretInputHandles(nodeId: string): Set<string> {
    return new Set<string>(
      manifest.edges
        .filter(
          (edge) =>
            edge.target === nodeId &&
            nodeById.get(edge.source)?.type === "get-secret" &&
            (edge.sourceHandle || "result") === "value",
        )
        .map((edge) => edge.targetHandle || "input"),
    )
  }

  function redactNodeOutputsForEvent(
    node: WorkflowManifestNode,
    outputs: unknown,
  ): WorkflowNodeOutputs {
    const redacted = cloneRecord(outputs)
    if (node.type === "get-secret" && Object.prototype.hasOwnProperty.call(redacted, "value")) {
      redacted.value = redactSecretValue(redacted.value)
    }
    if (
      node.type === "slack-trigger" &&
      Object.prototype.hasOwnProperty.call(redacted, "responseUrl")
    ) {
      redacted.responseUrl = redactSecretValue(redacted.responseUrl)
    }
    const object = recordFromUnknown(redacted.object)
    if (node.type === "json-object" && object) {
      const redactedObject = { ...object }
      getSecretInputHandles(node.id).forEach((handle) => {
        if (Object.prototype.hasOwnProperty.call(redactedObject, handle)) {
          redactedObject[handle] = redactSecretValue(redactedObject[handle])
        }
      })
      redacted.object = redactedObject
    }
    return redacted
  }

  function collectInputs(nodeId: string, outputs: WorkflowRuntimeOutputs): Record<string, unknown> {
    const inputs = getManualInputValues(nodeById.get(nodeId))
    manifest.edges
      .filter((edge) => edge.target === nodeId && edge.source in outputs)
      .forEach((edge) => {
        const sourceOutputs = outputs[edge.source] ?? {}
        const targetKey = edge.targetHandle || "input"
        const sourceKey = edge.sourceHandle || "result"
        inputs[targetKey] =
          sourceOutputs && typeof sourceOutputs === "object" && sourceKey in sourceOutputs
            ? sourceOutputs[sourceKey]
            : sourceOutputs
      })
    return inputs
  }

  function shouldRunNode(
    nodeId: string,
    outputs: WorkflowRuntimeOutputs,
    skippedNodeIds: Set<string>,
  ): boolean {
    const incomingEdges = manifest.edges.filter((edge) => edge.target === nodeId)
    if (incomingEdges.some((edge) => skippedNodeIds.has(edge.source))) {
      return false
    }
    const triggerEdges = incomingEdges.filter((edge) => {
      const source = nodeById.get(edge.source)
      return Boolean(source && isWorkflowTriggerNodeType(source.type))
    })
    const branchEdges = incomingEdges.filter((edge) => {
      const source = nodeById.get(edge.source)
      const sourceHandle = edge.sourceHandle || "result"
      return source?.type === "if-else" && (sourceHandle === "true" || sourceHandle === "false")
    })
    const hasTriggerGate = triggerEdges.length > 0
    const hasActiveTriggerGate = triggerEdges.some((edge) => edge.source in outputs)
    const hasBranchGate = branchEdges.length > 0
    const hasActiveBranchGate = branchEdges.some((edge) => {
      const sourceOutputs = outputs[edge.source] ?? {}
      const sourceHandle = edge.sourceHandle || "result"
      return Boolean(
        sourceOutputs && typeof sourceOutputs === "object" && sourceHandle in sourceOutputs,
      )
    })
    return (!hasTriggerGate || hasActiveTriggerGate) && (!hasBranchGate || hasActiveBranchGate)
  }

  return {
    createInitialOutputs(trigger, eventTimestamp) {
      const outputs: WorkflowRuntimeOutputs = {}
      manifest.nodes
        .filter((node) => isActiveTriggerNode(node, trigger))
        .forEach((node) => {
          outputs[node.id] = getTriggerOutputs(node, trigger, eventTimestamp)
        })
      return outputs
    },
    collectInputs,
    shouldRunNode,
    redactInputsForEvent(nodeId, inputs) {
      const redacted = cloneRecord(inputs)
      manifest.edges
        .filter((edge) => edge.target === nodeId)
        .forEach((edge) => {
          const source = nodeById.get(edge.source)
          const sourceHandle = edge.sourceHandle || "result"
          if (source?.type === "get-secret" && sourceHandle === "value") {
            redacted[edge.targetHandle || "input"] = "[redacted]"
          }
          if (
            source?.type === "json-object" &&
            sourceHandle === "object" &&
            getSecretInputHandles(source.id).size > 0
          ) {
            redacted[edge.targetHandle || "input"] = "[redacted]"
          }
        })
      return redacted
    },
    redactActionResultForEvent(node, result) {
      const record = recordFromUnknown(result)
      if (!record) {
        return result
      }
      return {
        ...record,
        outputs: redactNodeOutputsForEvent(node, record.outputs ?? {}),
      }
    },
    redactWorkflowOutputsForEvent(outputs) {
      return Object.fromEntries(
        Object.entries(outputs).map(([nodeId, nodeOutputs]) => {
          const node = nodeById.get(nodeId)
          return [nodeId, node ? redactNodeOutputsForEvent(node, nodeOutputs) : nodeOutputs]
        }),
      )
    },
  }
}

export const WORKFLOW_RUNTIME_KERNEL_V1_SOURCE = String.raw`
function recordFromUnknown(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cloneRecord(record) {
  return { ...recordFromUnknown(record) };
}

function redactSecretValue(value) {
  return value === null || value === undefined ? value : "[redacted]";
}

export function normalizeActionResult(result) {
  const record = recordFromUnknown(result);
  if (record && "outputs" in record) {
    return record;
  }
  return { outputs: { result } };
}

function getTriggerNodeType(kind) {
  if (kind === "webhook") return "webhook-trigger";
  if (kind === "datetime") return "datetime-trigger";
  if (kind === "cron") return "cron-trigger";
  return "manual-trigger";
}

function isTriggerNode(node) {
  return (
    node.type === "manual-trigger" ||
    node.type === "webhook-trigger" ||
    node.type === "datetime-trigger" ||
    node.type === "cron-trigger"
  );
}

function isActiveTriggerNode(node, trigger) {
  if (node.type !== getTriggerNodeType(trigger?.kind)) {
    return false;
  }
  return typeof trigger?.nodeId === "string" && trigger.nodeId
    ? node.id === trigger.nodeId
    : true;
}

function getTriggerOutputs(node, trigger, eventTimestamp) {
  if (node.type === "manual-trigger") {
    return {
      payload: trigger?.payload ?? {},
    };
  }
  if (node.type === "webhook-trigger") {
    const payload = recordFromUnknown(trigger?.payload) ?? {};
    return {
      body: payload.body ?? trigger?.payload ?? null,
      headers: payload.headers ?? {},
      query: payload.query ?? {},
    };
  }
  if (node.type === "datetime-trigger") {
    return {
      scheduledAt: trigger?.scheduledAt ?? node.options.scheduledAt ?? null,
      firedAt: trigger?.firedAt ?? eventTimestamp,
    };
  }
  if (node.type === "cron-trigger") {
    return {
      cron: trigger?.cron ?? node.options.cron ?? null,
      scheduledAt: trigger?.scheduledAt ?? null,
      firedAt: trigger?.firedAt ?? eventTimestamp,
    };
  }
  return {};
}

function getManualInputValues(node) {
  return cloneRecord(node?.options?.inputValues);
}

export function createWorkflowRuntimeKernel(manifest) {
  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]));

  function getSecretInputHandles(nodeId) {
    const handles = new Set();
    for (const edge of manifest.edges) {
      if (edge.target !== nodeId) {
        continue;
      }
      const source = nodeById.get(edge.source);
      const sourceHandle = edge.sourceHandle || "result";
      if (source?.type === "get-secret" && sourceHandle === "value") {
        handles.add(edge.targetHandle || "input");
      }
    }
    return handles;
  }

  function redactNodeOutputsForEvent(node, outputs) {
    const redacted = cloneRecord(outputs);
    if (node.type === "get-secret" && Object.prototype.hasOwnProperty.call(redacted, "value")) {
      redacted.value = redactSecretValue(redacted.value);
    }
    const object = recordFromUnknown(redacted.object);
    if (node.type === "json-object" && object) {
      const redactedObject = { ...object };
      for (const handle of getSecretInputHandles(node.id)) {
        if (Object.prototype.hasOwnProperty.call(redactedObject, handle)) {
          redactedObject[handle] = redactSecretValue(redactedObject[handle]);
        }
      }
      redacted.object = redactedObject;
    }
    return redacted;
  }

  function collectInputs(nodeId, outputs) {
    const inputs = getManualInputValues(nodeById.get(nodeId));
    for (const edge of manifest.edges) {
      if (edge.target !== nodeId) {
        continue;
      }
      if (!(edge.source in outputs)) {
        continue;
      }
      const sourceOutputs = outputs[edge.source] ?? {};
      const targetKey = edge.targetHandle || "input";
      const sourceKey = edge.sourceHandle || "result";
      inputs[targetKey] =
        sourceOutputs && typeof sourceOutputs === "object" && sourceKey in sourceOutputs
          ? sourceOutputs[sourceKey]
          : sourceOutputs;
    }
    return inputs;
  }

  function shouldRunNode(nodeId, outputs, skippedNodeIds) {
    let hasBranchGate = false;
    let hasActiveBranchGate = false;
    let hasTriggerGate = false;
    let hasActiveTriggerGate = false;
    for (const edge of manifest.edges) {
      if (edge.target !== nodeId) {
        continue;
      }
      if (skippedNodeIds.has(edge.source)) {
        return false;
      }
      const source = nodeById.get(edge.source);
      const sourceHandle = edge.sourceHandle || "result";
      if (source && isTriggerNode(source)) {
        hasTriggerGate = true;
        if (edge.source in outputs) {
          hasActiveTriggerGate = true;
        }
        continue;
      }
      if (source?.type === "if-else" && (sourceHandle === "true" || sourceHandle === "false")) {
        hasBranchGate = true;
        const sourceOutputs = outputs[edge.source] ?? {};
        if (sourceOutputs && typeof sourceOutputs === "object" && sourceHandle in sourceOutputs) {
          hasActiveBranchGate = true;
        }
      }
    }
    return (!hasTriggerGate || hasActiveTriggerGate) && (!hasBranchGate || hasActiveBranchGate);
  }

  return {
    createInitialOutputs(trigger, eventTimestamp) {
      const outputs = {};
      for (const node of manifest.nodes) {
        if (isActiveTriggerNode(node, trigger)) {
          outputs[node.id] = getTriggerOutputs(node, trigger, eventTimestamp);
        }
      }
      return outputs;
    },
    collectInputs,
    shouldRunNode,
    redactInputsForEvent(nodeId, inputs) {
      const redacted = cloneRecord(inputs);
      for (const edge of manifest.edges) {
        if (edge.target !== nodeId) {
          continue;
        }
        const source = nodeById.get(edge.source);
        const sourceHandle = edge.sourceHandle || "result";
        if (source?.type === "get-secret" && sourceHandle === "value") {
          redacted[edge.targetHandle || "input"] = "[redacted]";
        }
        if (source?.type === "json-object" && sourceHandle === "object" && getSecretInputHandles(source.id).size > 0) {
          redacted[edge.targetHandle || "input"] = "[redacted]";
        }
      }
      return redacted;
    },
    redactActionResultForEvent(node, result) {
      const record = recordFromUnknown(result);
      if (!record) {
        return result;
      }
      return {
        ...record,
        outputs: redactNodeOutputsForEvent(node, record.outputs ?? {}),
      };
    },
    redactWorkflowOutputsForEvent(outputs) {
      const redacted = {};
      for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
        const node = nodeById.get(nodeId);
        redacted[nodeId] = node ? redactNodeOutputsForEvent(node, nodeOutputs) : nodeOutputs;
      }
      return redacted;
    },
  };
}
`

function createWorkflowRuntimeKernelV2Source(): string {
  let source = WORKFLOW_RUNTIME_KERNEL_V1_SOURCE
  source = source.replace(
    [
      "function getTriggerNodeType(kind) {",
      '  if (kind === "webhook") return "webhook-trigger";',
      '  if (kind === "datetime") return "datetime-trigger";',
      '  if (kind === "cron") return "cron-trigger";',
      '  return "manual-trigger";',
      "}",
    ].join("\n"),
    [
      "function getTriggerNodeType(kind) {",
      '  if (kind === "webhook") return "webhook-trigger";',
      '  if (kind === "datetime") return "datetime-trigger";',
      '  if (kind === "cron") return "cron-trigger";',
      '  if (kind === "slack") return "slack-trigger";',
      '  return "manual-trigger";',
      "}",
    ].join("\n"),
  )
  source = source.replace(
    [
      '    node.type === "webhook-trigger" ||',
      '    node.type === "datetime-trigger" ||',
      '    node.type === "cron-trigger"',
    ].join("\n"),
    [
      '    node.type === "webhook-trigger" ||',
      '    node.type === "datetime-trigger" ||',
      '    node.type === "cron-trigger" ||',
      '    node.type === "slack-trigger"',
    ].join("\n"),
  )
  source = source.replace(
    [
      '  if (node.type === "cron-trigger") {',
      "    return {",
      "      cron: trigger?.cron ?? node.options.cron ?? null,",
      "      scheduledAt: trigger?.scheduledAt ?? null,",
      "      firedAt: trigger?.firedAt ?? eventTimestamp,",
      "    };",
      "  }",
      "  return {};",
    ].join("\n"),
    [
      '  if (node.type === "cron-trigger") {',
      "    return {",
      "      cron: trigger?.cron ?? node.options.cron ?? null,",
      "      scheduledAt: trigger?.scheduledAt ?? null,",
      "      firedAt: trigger?.firedAt ?? eventTimestamp,",
      "    };",
      "  }",
      '  if (node.type === "slack-trigger") {',
      "    const payload = recordFromUnknown(trigger?.payload) ?? {};",
      "    return {",
      "      teamId: payload.teamId ?? null,",
      "      channelId: payload.channelId ?? null,",
      "      channelName: payload.channelName ?? null,",
      "      userId: payload.userId ?? null,",
      '      text: payload.text ?? "",',
      "      eventType: payload.eventType ?? null,",
      "      command: payload.command ?? null,",
      "      messageTs: payload.messageTs ?? null,",
      "      threadTs: payload.threadTs ?? payload.messageTs ?? null,",
      "      triggerId: payload.triggerId ?? null,",
      "      actionId: payload.actionId ?? null,",
      "      responseUrl: payload.responseUrl ?? null,",
      "      rawPayload: recordFromUnknown(payload.rawPayload) ?? payload,",
      "    };",
      "  }",
      "  return {};",
    ].join("\n"),
  )
  source = source.replace(
    [
      '    if (node.type === "get-secret" && Object.prototype.hasOwnProperty.call(redacted, "value")) {',
      "      redacted.value = redactSecretValue(redacted.value);",
      "    }",
    ].join("\n"),
    [
      '    if (node.type === "get-secret" && Object.prototype.hasOwnProperty.call(redacted, "value")) {',
      "      redacted.value = redactSecretValue(redacted.value);",
      "    }",
      '    if (node.type === "slack-trigger" && Object.prototype.hasOwnProperty.call(redacted, "responseUrl")) {',
      "      redacted.responseUrl = redactSecretValue(redacted.responseUrl);",
      "    }",
    ].join("\n"),
  )
  if (source === WORKFLOW_RUNTIME_KERNEL_V1_SOURCE) {
    throw new Error("Failed to build workflow runtime kernel v2 source")
  }
  return source
}

export const WORKFLOW_RUNTIME_KERNEL_V2_SOURCE = createWorkflowRuntimeKernelV2Source()
export const WORKFLOW_RUNTIME_KERNEL_SOURCE = WORKFLOW_RUNTIME_KERNEL_V2_SOURCE
