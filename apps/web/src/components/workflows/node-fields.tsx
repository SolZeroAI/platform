import { Input, InputArea } from "@cloudflare/kumo/components/input"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Label } from "@cloudflare/kumo/components/label"
import { Select } from "@cloudflare/kumo/components/select"
import { ChevronDown, ChevronRight, Copy, KeyRound, Plus, Trash2 } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { type RuntimeModelCategory, validateWorkflowJsonObjectFieldName } from "@c0-agent/shared"
import {
  AiProviderLoadingButton,
  AiProviderRequiredButton,
} from "@/components/ai-provider-required"
import { HomeSecretsDialog } from "@/components/home-session-tools-dialog"
import { formatReasoningEffortLabel, ModelThinkingDialog } from "@/components/model-thinking-dialog"
import { copyToClipboard } from "@/lib/format"
import { recessedInputClassName, recessedInputGroupClassName } from "@/lib/recessed-field"
import {
  WorkflowHeaderDraftRow,
  WorkflowHeaderDraftRowErrors,
  WorkflowTemplateReferenceOption,
} from "./types"
import { WorkflowTemplateReferenceDescription } from "./modals"

export function FieldLabel({
  label,
  helpText,
  htmlFor,
}: {
  label: string
  helpText?: string
  htmlFor?: string
}) {
  return (
    <Label htmlFor={htmlFor} tooltip={helpText}>
      {label}
    </Label>
  )
}

export function TemplateInput({
  label,
  value,
  onChange,
  type = "text",
  templateOptions,
  helpText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  templateOptions: WorkflowTemplateReferenceOption[]
  helpText?: string
}) {
  const templateDescription =
    !helpText && templateOptions.length > 0 ? (
      <WorkflowTemplateReferenceDescription options={templateOptions} />
    ) : undefined

  return (
    <div className="mt-3">
      <Input
        label={label}
        labelTooltip={helpText}
        description={templateDescription}
        type={type}
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full text-sm! ${recessedInputClassName(false)}`}
      />
    </div>
  )
}

export function TemplateTextarea({
  label,
  value,
  onChange,
  onBlur,
  errorText,
  mono,
  templateOptions,
  helpText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  errorText?: string | null
  mono?: boolean
  templateOptions: WorkflowTemplateReferenceOption[]
  helpText?: string
}) {
  const invalid = Boolean(errorText)
  const templateDescription =
    !helpText && templateOptions.length > 0 ? (
      <WorkflowTemplateReferenceDescription options={templateOptions} />
    ) : undefined

  return (
    <div className="mt-3">
      <InputArea
        label={label}
        labelTooltip={helpText}
        description={templateDescription}
        size="sm"
        rows={5}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        error={errorText || undefined}
        className={`resize-none ${recessedInputClassName(invalid)} ${mono ? "font-mono" : "text-sm!"}`}
      />
    </div>
  )
}

export function WorkflowHeadersEditor({
  rows,
  onAdd,
  onChangeRow,
  onRemove,
  errorText,
  rowErrors,
  templateOptions,
  helpText,
}: {
  rows: WorkflowHeaderDraftRow[]
  onAdd: () => void
  onChangeRow: (
    rowId: string,
    updates: Partial<Pick<WorkflowHeaderDraftRow, "key" | "value">>,
  ) => void
  onRemove: (rowId: string) => void
  errorText?: string | null
  rowErrors: WorkflowHeaderDraftRowErrors
  templateOptions: WorkflowTemplateReferenceOption[]
  helpText?: string
}) {
  const errorId = useId()

  return (
    <div className="mt-3" data-workflow-config-section="Headers">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <FieldLabel label="Headers" helpText={helpText} />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-kumo-line p-1.5 text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default"
          title="Add header"
          aria-label="Add header"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <WorkflowTemplateReferenceDescription options={templateOptions} />
      {rows.length > 0 ? (
        <div className="mt-2 space-y-2">
          {rows.map((row) => {
            const rowError = rowErrors[row.id]
            const keyInvalid = Boolean(rowError?.key)
            const valueInvalid = Boolean(rowError?.value)

            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_34px] gap-2"
              >
                <div className="min-w-0">
                  <Input
                    aria-label="Header name"
                    size="sm"
                    value={row.key}
                    onChange={(event) => onChangeRow(row.id, { key: event.target.value })}
                    aria-invalid={keyInvalid}
                    aria-describedby={keyInvalid ? errorId : undefined}
                    className={`w-full font-mono ${recessedInputClassName(keyInvalid)}`}
                    placeholder="Header"
                  />
                </div>
                <div className="min-w-0">
                  <Input
                    aria-label="Header value"
                    size="sm"
                    value={row.value}
                    onChange={(event) => onChangeRow(row.id, { value: event.target.value })}
                    aria-invalid={valueInvalid}
                    aria-describedby={valueInvalid ? errorId : undefined}
                    className={`w-full font-mono ${recessedInputClassName(valueInvalid)}`}
                    placeholder="{{inputs.headers.alert.alertId}}"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-kumo-line text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-danger-tint/10 hover:text-kumo-danger active:scale-[0.96]"
                  title="Remove header"
                  aria-label="Remove header"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-kumo-line bg-kumo-tint px-2 py-1.5 text-xs text-kumo-subtle">
          No headers configured
        </div>
      )}
      {errorText ? (
        <p id={errorId} className="mt-1.5 text-xs text-kumo-danger">
          {errorText}
        </p>
      ) : null}
    </div>
  )
}

export function JsonObjectFieldsEditor({
  fields,
  onAdd,
  onRename,
  onRemove,
  helpText,
}: {
  fields: string[]
  onAdd: () => void
  onRename: (previousField: string, nextField: string) => boolean
  onRemove: (field: string) => void
  helpText?: string
}) {
  const fieldsKey = fields.join("\u0000")
  const syncedFieldsKeyRef = useRef(fieldsKey)
  const [drafts, setDrafts] = useState(fields)

  useEffect(() => {
    if (syncedFieldsKeyRef.current === fieldsKey) {
      return
    }
    syncedFieldsKeyRef.current = fieldsKey
    setDrafts(fields)
  }, [fields, fieldsKey])

  const updateDraft = (index: number, value: string) => {
    setDrafts((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? value : field)),
    )
  }

  const commitDraft = (index: number) => {
    const previousField = fields[index]
    if (!previousField) {
      return
    }
    const nextField = drafts[index]?.trim() ?? ""
    if (!onRename(previousField, nextField)) {
      setDrafts(fields)
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <FieldLabel label="Fields" helpText={helpText} />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-kumo-line p-1.5 text-kumo-subtle transition hover:bg-kumo-tint hover:text-kumo-default"
          title="Add field"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-2">
        {fields.map((field, index) => {
          const draft = drafts[index] ?? field
          const duplicate = fields.some((item, itemIndex) => itemIndex !== index && item === draft)
          const invalid = !validateWorkflowJsonObjectFieldName(draft) || duplicate
          return (
            <div key={field} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Field"
                  size="sm"
                  value={draft}
                  onChange={(event) => updateDraft(index, event.target.value)}
                  onBlur={() => commitDraft(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur()
                    }
                  }}
                  aria-invalid={invalid}
                  className={`w-full font-mono ${recessedInputClassName(invalid)}`}
                />
              </div>
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => onRemove(field)}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-kumo-line text-kumo-subtle transition-[background-color,color,transform] hover:bg-kumo-danger-tint/10 hover:text-kumo-danger active:scale-[0.96]"
                  title="Remove field"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  compact = false,
  helpText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  compact?: boolean
  helpText?: string
}) {
  return (
    <div className={compact ? "block" : "mt-3"}>
      <Input
        label={label}
        labelTooltip={helpText}
        type={type}
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full text-sm! ${recessedInputClassName(false)}`}
      />
    </div>
  )
}

export function LabeledNodeIdInput({
  label,
  value,
  existingIds,
  onCommit,
  helpText,
}: {
  label: string
  value: string
  existingIds: string[]
  onCommit: (value: string) => boolean
  helpText?: string
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const validationError = getNodeIdValidationError(draft, value, existingIds)
  const showValidationError = draft.trim() !== value && validationError !== null

  const commitDraft = () => {
    const nextValue = draft.trim()
    if (nextValue === value) {
      setDraft(value)
      return
    }
    if (getNodeIdValidationError(nextValue, value, existingIds)) {
      setDraft(value)
      return
    }
    if (!onCommit(nextValue)) {
      setDraft(value)
    }
  }

  return (
    <div className="mt-3">
      <InputGroup
        size="sm"
        label={label}
        labelTooltip={helpText}
        className={recessedInputGroupClassName}
        error={
          showValidationError && validationError
            ? { message: validationError, match: true }
            : undefined
        }
      >
        <InputGroup.Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commitDraft()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              setDraft(value)
            }
          }}
          className="font-mono text-xs"
        />
        <InputGroup.Addon align="end">
          <InputGroup.Button
            shape="square"
            icon={<Copy className="h-4 w-4" aria-hidden />}
            aria-label="Copy node ID"
            tooltip="Copy node ID"
            onClick={() => void copyToClipboard(draft.trim() || value)}
          />
        </InputGroup.Addon>
      </InputGroup>
    </div>
  )
}

export function getNodeIdValidationError(
  value: string,
  currentValue: string,
  existingIds: string[],
): string | null {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return "Node ID is required."
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmedValue)) {
    return "Use letters, numbers, underscores, periods, or dashes."
  }
  if (trimmedValue !== currentValue && existingIds.includes(trimmedValue)) {
    return "Node ID must be unique."
  }
  return null
}

export function LabeledSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
  helpText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  helpText?: string
}) {
  return (
    <div className="mt-3">
      <Select
        label={label}
        labelTooltip={helpText}
        size="sm"
        value={value}
        onValueChange={(next) => onChange((next as string | null) ?? "")}
        disabled={disabled}
        className={`w-full text-sm! ${recessedInputClassName(false)}`}
      >
        {options.map((option) => (
          <Select.Option key={option.value} value={option.value}>
            {option.label}
          </Select.Option>
        ))}
      </Select>
    </div>
  )
}

export function WorkflowModelThinkingField({
  modelValue,
  reasoningEffort,
  modelOptions,
  loading = false,
  isAdmin,
  onModelChange,
  onReasoningChange,
  helpText,
}: {
  modelValue: string
  reasoningEffort: string
  modelOptions: RuntimeModelCategory[]
  loading?: boolean
  isAdmin: boolean
  onModelChange: (value: string, reasoningEffort: string) => void
  onReasoningChange: (value: string) => void
  helpText?: string
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const allModels = useMemo(() => modelOptions.flatMap((group) => group.models), [modelOptions])
  const hasOptions = modelOptions.some((group) => group.models.length > 0)
  const selectedModel = useMemo(
    () => allModels.find((model) => model.id === modelValue) ?? null,
    [allModels, modelValue],
  )
  const selectedReasoning = reasoningEffort || selectedModel?.reasoning?.default
  const reasoningLabel =
    selectedModel?.reasoning && selectedReasoning
      ? `${formatReasoningEffortLabel(selectedReasoning)} thinking`
      : "Provider default"
  const displayValue = selectedModel
    ? `${selectedModel.name} - ${reasoningLabel}`
    : modelValue || "Select model"

  if (loading) {
    return <AiProviderLoadingButton variant="field" />
  }

  if (!hasOptions) {
    return <AiProviderRequiredButton isAdmin={isAdmin} variant="field" />
  }

  return (
    <div className="mt-3">
      <FieldLabel label="Model and thinking" helpText={helpText} />
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label="Model and thinking"
        className="mt-1 flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-recessed px-2 py-1.5 text-left text-sm text-kumo-default outline-none transition-[background-color,border-color,box-shadow,transform] hover:border-kumo-line hover:bg-kumo-control focus-visible:ring-2 focus-visible:ring-kumo-focus active:scale-[0.99]"
      >
        <span
          className={`min-w-0 flex-1 truncate ${modelValue ? "text-kumo-default" : "text-kumo-placeholder"}`}
        >
          {displayValue}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-kumo-subtle" aria-hidden />
      </button>
      {dialogOpen ? (
        <ModelThinkingDialog
          modelOptions={modelOptions}
          selectedModel={modelValue}
          selectedModelOption={selectedModel}
          reasoningEffort={reasoningEffort || undefined}
          onModelSelect={(value) => {
            const nextModel = allModels.find((model) => model.id === value) ?? null
            onModelChange(value, nextModel?.reasoning?.default ?? "")
          }}
          onReasoningSelect={(value) => onReasoningChange(value ?? "")}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  )
}

export function SecretsDialogControls({
  selectedSecretKeys,
  onChange,
  helpText,
}: {
  selectedSecretKeys: string[]
  onChange: (keys: string[]) => void
  helpText?: string
}) {
  const [secretsDialogOpen, setSecretsDialogOpen] = useState(false)
  const secretsSummary =
    selectedSecretKeys.length === 0
      ? "No secrets attached"
      : selectedSecretKeys.length === 1
        ? selectedSecretKeys[0]
        : `${selectedSecretKeys.length} secrets attached`

  return (
    <div className="mt-3">
      <FieldLabel label="Attach secrets" helpText={helpText} />
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setSecretsDialogOpen(true)}
          className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-kumo-hairline bg-kumo-tint px-2.5 py-2 text-left transition-[background-color,color,transform] hover:bg-kumo-tint active:scale-[0.96]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <KeyRound className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-kumo-default">Secrets</span>
              <span className="block truncate text-xs text-kumo-subtle">{secretsSummary}</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-kumo-subtle" aria-hidden />
        </button>
      </div>
      <HomeSecretsDialog
        open={secretsDialogOpen}
        onClose={() => setSecretsDialogOpen(false)}
        selectedSecretKeys={selectedSecretKeys}
        onSave={onChange}
        saveLabel="Apply"
        description="Attached secrets are injected as environment variables for this agent node."
      />
    </div>
  )
}
