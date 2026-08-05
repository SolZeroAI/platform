import { Input } from "@cloudflare/kumo/components/input"
import { MAX_ISOLATE_STEP_LIMIT, MIN_ISOLATE_STEP_LIMIT, type SubagentMode } from "@solzero/shared"
import type { Ref } from "react"
import { SubagentModeField } from "@/components/subagent-mode-field"

export function IsolateAgentControls({
  stepLimitInputRef,
  stepLimit,
  onStepLimitChange,
  showSubagents,
  subagents,
  onSubagentsChange,
}: {
  stepLimitInputRef: Ref<HTMLInputElement>
  stepLimit: string
  onStepLimitChange: (value: string) => void
  showSubagents: boolean
  subagents: SubagentMode
  onSubagentsChange: (value: SubagentMode) => void
}) {
  return (
    <section className="border-b border-kumo-line pb-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor="agent-tools-step-limit" className="text-sm font-medium text-kumo-default">
            Tool call limit
          </label>
          <p className="mt-1 text-sm text-kumo-subtle">
            Set the maximum tool-call steps this isolate agent can use for each response.
          </p>
        </div>
        <Input
          ref={stepLimitInputRef}
          id="agent-tools-step-limit"
          type="number"
          min={MIN_ISOLATE_STEP_LIMIT}
          max={MAX_ISOLATE_STEP_LIMIT}
          step={1}
          value={stepLimit}
          onChange={(event) => onStepLimitChange(event.target.value)}
          aria-label="Tool call limit"
          className="w-28 shrink-0 tabular-nums"
        />
      </div>
      {showSubagents ? (
        <div className="mt-5 border-t border-kumo-hairline pt-5">
          <SubagentModeField value={subagents} onChange={onSubagentsChange} />
        </div>
      ) : null}
    </section>
  )
}
