import {
  isWorkflowTriggerNodeType,
  type WorkflowManifest,
  type WorkflowManifestEdge,
  type WorkflowManifestNode,
  type WorkflowNodeType,
} from "@solzero/shared"
import * as Match from "effect/Match"
import * as Option from "effect/Option"

export const WORKFLOW_RUNTIME_KERNEL_V1_MODULE_NAME = "workflow-runtime-kernel.v1.js"
export const WORKFLOW_RUNTIME_KERNEL_V2_MODULE_NAME = "workflow-runtime-kernel.v2.js"

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

function recordOptionFromUnknown(value: unknown): Option.Option<Record<string, unknown>> {
  return Option.liftPredicate(value, (resolved: unknown): resolved is Record<string, unknown> =>
    Boolean(resolved && typeof resolved === "object" && !Array.isArray(resolved)),
  )
}

function cloneRecord(record: unknown): Record<string, unknown> {
  return { ...Option.getOrElse(recordOptionFromUnknown(record), () => ({})) }
}

function redactSecretValue(value: unknown): unknown {
  return Match.value(value === null || value === undefined).pipe(
    Match.when(true, () => value),
    Match.orElse(() => "[redacted]"),
  )
}

function wrapPrimitiveActionResult(result: unknown): WorkflowActionResult {
  return { outputs: { result } }
}

export function normalizeActionResult(result: unknown): WorkflowActionResult {
  return Option.match(recordOptionFromUnknown(result), {
    onNone: () => wrapPrimitiveActionResult(result),
    onSome: (record) =>
      Match.value("outputs" in record).pipe(
        Match.when(true, () => record as WorkflowActionResult),
        Match.orElse(() => wrapPrimitiveActionResult(result)),
      ),
  })
}

function getTriggerNodeType(kind: unknown): WorkflowNodeType {
  return Match.value(kind).pipe(
    Match.when("webhook", () => "webhook-trigger" as const),
    Match.when("datetime", () => "datetime-trigger" as const),
    Match.when("cron", () => "cron-trigger" as const),
    Match.when("slack", () => "slack-trigger" as const),
    Match.orElse(() => "manual-trigger" as const),
  )
}

function addressedTriggerNode(
  node: WorkflowManifestNode,
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
): boolean {
  return Option.match(
    Option.liftPredicate(
      trigger?.nodeId,
      (value: unknown): value is string => typeof value === "string" && value.length > 0,
    ),
    {
      onNone: () => true,
      onSome: (nodeId) => node.id === nodeId,
    },
  )
}

function isActiveTriggerNode(
  node: WorkflowManifestNode,
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
): boolean {
  return Match.value(node.type === getTriggerNodeType(trigger?.kind)).pipe(
    Match.when(false, () => false),
    Match.orElse(() => addressedTriggerNode(node, trigger)),
  )
}

function triggerPayloadRecord(
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
): Record<string, unknown> {
  return Option.getOrElse(recordOptionFromUnknown(trigger?.payload), () => ({}))
}

function getTriggerOutputs(
  node: WorkflowManifestNode,
  trigger: WorkflowRuntimeTriggerPayload | null | undefined,
  eventTimestamp: string | null,
): WorkflowNodeOutputs {
  const payload = triggerPayloadRecord(trigger)
  return Match.value(node.type).pipe(
    Match.when(
      "manual-trigger",
      (): WorkflowNodeOutputs => ({
        payload: trigger?.payload ?? {},
      }),
    ),
    Match.when(
      "webhook-trigger",
      (): WorkflowNodeOutputs => ({
        body: payload.body ?? trigger?.payload ?? null,
        headers: payload.headers ?? {},
        query: payload.query ?? {},
      }),
    ),
    Match.when(
      "datetime-trigger",
      (): WorkflowNodeOutputs => ({
        scheduledAt: trigger?.scheduledAt ?? node.options.scheduledAt ?? null,
        firedAt: trigger?.firedAt ?? eventTimestamp,
      }),
    ),
    Match.when(
      "cron-trigger",
      (): WorkflowNodeOutputs => ({
        cron: trigger?.cron ?? node.options.cron ?? null,
        scheduledAt: trigger?.scheduledAt ?? null,
        firedAt: trigger?.firedAt ?? eventTimestamp,
      }),
    ),
    Match.when("slack-trigger", () => slackTriggerOutputs(payload)),
    Match.orElse(() => ({})),
  )
}

function slackTriggerOutputs(payload: Record<string, unknown>): WorkflowNodeOutputs {
  const rawPayload = Option.getOrElse(recordOptionFromUnknown(payload.rawPayload), () => payload)
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
    rawPayload,
  }
}

function getManualInputValues(node: WorkflowManifestNode | undefined): Record<string, unknown> {
  return cloneRecord(node?.options.inputValues)
}

function recordHasHandle(outputs: unknown, handle: string): boolean {
  return Boolean(outputs && typeof outputs === "object" && handle in outputs)
}

function redactOwnedField(
  record: Record<string, unknown>,
  key: string,
  shouldRedact: boolean,
): Record<string, unknown> {
  return Match.value(shouldRedact && Object.prototype.hasOwnProperty.call(record, key)).pipe(
    Match.when(true, () => ({ ...record, [key]: redactSecretValue(record[key]) })),
    Match.orElse(() => record),
  )
}

function redactJsonObjectSecrets(
  node: WorkflowManifestNode,
  record: Record<string, unknown>,
  secretHandles: Set<string>,
): Record<string, unknown> {
  const object = recordOptionFromUnknown(record.object)
  const redactedObject = Object.fromEntries(
    Object.entries(Option.getOrElse(object, () => ({}))).map(([handle, value]) => [
      handle,
      Match.value(secretHandles.has(handle)).pipe(
        Match.when(true, () => redactSecretValue(value)),
        Match.orElse(() => value),
      ),
    ]),
  )
  return Match.value(node.type === "json-object" && Option.isSome(object)).pipe(
    Match.when(true, () => ({ ...record, object: redactedObject })),
    Match.orElse(() => record),
  )
}

function assignConnectedInput(
  inputs: Record<string, unknown>,
  edge: WorkflowManifestEdge,
  outputs: WorkflowRuntimeOutputs,
): Record<string, unknown> {
  const sourceOutputs = outputs[edge.source] ?? {}
  const targetKey = edge.targetHandle || "input"
  const sourceKey = edge.sourceHandle || "result"
  const assigned = Match.value(recordHasHandle(sourceOutputs, sourceKey)).pipe(
    Match.when(true, () => sourceOutputs[sourceKey]),
    Match.orElse(() => sourceOutputs),
  )
  return { ...inputs, [targetKey]: assigned }
}

function redactInputFromEdge(
  redacted: Record<string, unknown>,
  edge: WorkflowManifestEdge,
  source: WorkflowManifestNode | undefined,
  secretHandles: Set<string>,
): Record<string, unknown> {
  const sourceHandle = edge.sourceHandle || "result"
  const targetHandle = edge.targetHandle || "input"
  const withSecret = Match.value(source?.type === "get-secret" && sourceHandle === "value").pipe(
    Match.when(true, () => ({ ...redacted, [targetHandle]: "[redacted]" })),
    Match.orElse(() => redacted),
  )
  return Match.value(
    source?.type === "json-object" && sourceHandle === "object" && secretHandles.size > 0,
  ).pipe(
    Match.when(true, () => ({ ...withSecret, [targetHandle]: "[redacted]" })),
    Match.orElse(() => withSecret),
  )
}

export function createWorkflowRuntimeKernel(manifest: WorkflowManifest): WorkflowRuntimeKernel {
  const nodeById = new Map(manifest.nodes.map((node) => [node.id, node]))

  function isBranchGateEdge(edge: WorkflowManifestEdge): boolean {
    const source = nodeById.get(edge.source)
    const sourceHandle = edge.sourceHandle || "result"
    return source?.type === "if-else" && (sourceHandle === "true" || sourceHandle === "false")
  }

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
    const withSecret = redactOwnedField(cloneRecord(outputs), "value", node.type === "get-secret")
    const withResponseUrl = redactOwnedField(
      withSecret,
      "responseUrl",
      node.type === "slack-trigger",
    )
    return redactJsonObjectSecrets(node, withResponseUrl, getSecretInputHandles(node.id))
  }

  function collectInputs(nodeId: string, outputs: WorkflowRuntimeOutputs): Record<string, unknown> {
    return manifest.edges
      .filter((edge) => edge.target === nodeId && edge.source in outputs)
      .reduce(
        (inputs, edge) => assignConnectedInput(inputs, edge, outputs),
        getManualInputValues(nodeById.get(nodeId)),
      )
  }

  function shouldRunNode(
    nodeId: string,
    outputs: WorkflowRuntimeOutputs,
    skippedNodeIds: Set<string>,
  ): boolean {
    const incomingEdges = manifest.edges.filter((edge) => edge.target === nodeId)
    const triggerEdges = incomingEdges.filter((edge) =>
      Option.exists(Option.fromNullishOr(nodeById.get(edge.source)), (source) =>
        isWorkflowTriggerNodeType(source.type),
      ),
    )
    const branchEdges = incomingEdges.filter(isBranchGateEdge)
    const gated =
      (!triggerEdges.length || triggerEdges.some((edge) => edge.source in outputs)) &&
      (!branchEdges.length ||
        branchEdges.some((edge) =>
          recordHasHandle(outputs[edge.source] ?? {}, edge.sourceHandle || "result"),
        ))
    return Match.value(incomingEdges.some((edge) => skippedNodeIds.has(edge.source))).pipe(
      Match.when(true, () => false),
      Match.orElse(() => gated),
    )
  }

  return {
    createInitialOutputs(trigger, eventTimestamp) {
      return Object.fromEntries(
        manifest.nodes
          .filter((node) => isActiveTriggerNode(node, trigger))
          .map((node) => [node.id, getTriggerOutputs(node, trigger, eventTimestamp)]),
      )
    },
    collectInputs,
    shouldRunNode,
    redactInputsForEvent(nodeId, inputs) {
      return manifest.edges
        .filter((edge) => edge.target === nodeId)
        .reduce(
          (redacted, edge) =>
            redactInputFromEdge(
              redacted,
              edge,
              nodeById.get(edge.source),
              getSecretInputHandles(edge.source),
            ),
          cloneRecord(inputs),
        )
    },
    redactActionResultForEvent(node, result) {
      return Option.match(recordOptionFromUnknown(result), {
        onNone: () => result,
        onSome: (record) => ({
          ...record,
          outputs: redactNodeOutputsForEvent(node, record.outputs ?? {}),
        }),
      })
    },
    redactWorkflowOutputsForEvent(outputs) {
      return Object.fromEntries(
        Object.entries(outputs).map(([nodeId, nodeOutputs]) => [
          nodeId,
          Option.match(Option.fromNullishOr(nodeById.get(nodeId)), {
            onNone: () => nodeOutputs,
            onSome: (node) => redactNodeOutputsForEvent(node, nodeOutputs),
          }),
        ]),
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

export const WORKFLOW_RUNTIME_KERNEL_V2_SOURCE = String.raw`
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
  if (kind === "slack") return "slack-trigger";
  return "manual-trigger";
}

function isTriggerNode(node) {
  return (
    node.type === "manual-trigger" ||
    node.type === "webhook-trigger" ||
    node.type === "datetime-trigger" ||
    node.type === "cron-trigger" ||
    node.type === "slack-trigger"
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
  if (node.type === "slack-trigger") {
    const payload = recordFromUnknown(trigger?.payload) ?? {};
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
    if (node.type === "slack-trigger" && Object.prototype.hasOwnProperty.call(redacted, "responseUrl")) {
      redacted.responseUrl = redactSecretValue(redacted.responseUrl);
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
