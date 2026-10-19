import { useRef } from "react"
import { Select } from "@cloudflare/kumo/components/select"
import { normalizeSubagentMode, type SubagentMode } from "@solzero/shared"

export function SubagentModeField({
  value,
  onChange,
}: {
  value: SubagentMode
  onChange: (value: SubagentMode) => void
}) {
  const portalContainer = useRef<HTMLDivElement>(null)
  return (
    <div ref={portalContainer} className="relative z-10">
      <Select
        container={portalContainer}
        label="Sub-agents"
        labelTooltip="Let this isolate agent delegate independent tasks to child agents."
        value={value}
        onValueChange={(next) => onChange(normalizeSubagentMode(next))}
        aria-label="Sub-agents"
        className="w-full"
      >
        <Select.Option value="enabled">Enabled</Select.Option>
        <Select.Option value="disabled">Disabled</Select.Option>
      </Select>
    </div>
  )
}
