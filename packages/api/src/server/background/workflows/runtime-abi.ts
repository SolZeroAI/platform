import {
  WORKFLOW_RUNTIME_KERNEL_V1_MODULE_NAME,
  WORKFLOW_RUNTIME_KERNEL_V1_SOURCE,
  WORKFLOW_RUNTIME_KERNEL_V2_MODULE_NAME,
  WORKFLOW_RUNTIME_KERNEL_V2_SOURCE,
} from "./runtime-kernel"

export const CURRENT_WORKFLOW_RUNTIME_ABI_VERSION = 2 as const
export const WORKFLOW_RUNTIME_ABI_VERSIONS = [1, 2] as const

export type WorkflowRuntimeAbiVersion = (typeof WORKFLOW_RUNTIME_ABI_VERSIONS)[number]

export interface WorkflowRuntimeKernelModule {
  abiVersion: WorkflowRuntimeAbiVersion
  moduleName: string
  source: string
}

const WORKFLOW_RUNTIME_KERNELS = {
  1: {
    abiVersion: 1,
    moduleName: WORKFLOW_RUNTIME_KERNEL_V1_MODULE_NAME,
    source: WORKFLOW_RUNTIME_KERNEL_V1_SOURCE,
  },
  2: {
    abiVersion: 2,
    moduleName: WORKFLOW_RUNTIME_KERNEL_V2_MODULE_NAME,
    source: WORKFLOW_RUNTIME_KERNEL_V2_SOURCE,
  },
} satisfies Record<WorkflowRuntimeAbiVersion, WorkflowRuntimeKernelModule>

const FNV_1A_OFFSET_BASIS = 0x811c9dc5
const FNV_1A_PRIME = 0x01000193
const FINGERPRINT_FIELD_SEPARATOR = "\0"

function updateFingerprint(fingerprint: number, value: string): number {
  const next = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).reduce(
    (accumulator, codeUnit) => Math.imul(accumulator ^ codeUnit, FNV_1A_PRIME),
    fingerprint,
  )
  return next >>> 0
}

export function isWorkflowRuntimeAbiVersion(value: unknown): value is WorkflowRuntimeAbiVersion {
  return WORKFLOW_RUNTIME_ABI_VERSIONS.some((version) => version === value)
}

export function getWorkflowRuntimeKernel(
  version: WorkflowRuntimeAbiVersion,
): WorkflowRuntimeKernelModule {
  return WORKFLOW_RUNTIME_KERNELS[version]
}

export function getCurrentWorkflowRuntimeKernel(): WorkflowRuntimeKernelModule {
  return getWorkflowRuntimeKernel(CURRENT_WORKFLOW_RUNTIME_ABI_VERSION)
}

export function getWorkflowRuntimeKernelModuleName(
  version: WorkflowRuntimeAbiVersion = CURRENT_WORKFLOW_RUNTIME_ABI_VERSION,
): string {
  return getWorkflowRuntimeKernel(version).moduleName
}

export function getWorkflowRuntimeKernelModules(): Record<string, string> {
  return Object.fromEntries(
    WORKFLOW_RUNTIME_ABI_VERSIONS.map((version) => {
      const kernel = getWorkflowRuntimeKernel(version)
      return [kernel.moduleName, kernel.source]
    }),
  )
}

export function getWorkflowRuntimeKernelSourceFingerprint(
  modules: Record<string, string> = getWorkflowRuntimeKernelModules(),
): string {
  const fingerprint = Object.entries(modules)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce((accumulator, [moduleName, source]) => {
      const withModuleName = updateFingerprint(accumulator, moduleName)
      const withModuleSeparator = updateFingerprint(withModuleName, FINGERPRINT_FIELD_SEPARATOR)
      const withSource = updateFingerprint(withModuleSeparator, source)
      return updateFingerprint(withSource, FINGERPRINT_FIELD_SEPARATOR)
    }, FNV_1A_OFFSET_BASIS)
  return fingerprint.toString(36)
}

export function getWorkflowRuntimeLoaderCacheVersion(): string {
  return `runtime-abi-${WORKFLOW_RUNTIME_ABI_VERSIONS.join("-")}-${getWorkflowRuntimeKernelSourceFingerprint()}`
}
