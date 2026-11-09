import type { WorkflowNodeOptions } from "@solzero/shared"
import { TemplateInput } from "./node-fields"
import type { WorkflowTemplateReferenceOption } from "./types"

export function AiSearchUploadFields({
  options,
  templates,
  updateOption,
}: {
  options: WorkflowNodeOptions
  templates: WorkflowTemplateReferenceOption[]
  updateOption: (key: string, value: string) => void
}) {
  return (
    <>
      <TemplateInput
        label="AI Search source ID"
        value={String(options.aiSearchSourceId ?? "")}
        onChange={(value) => updateOption("aiSearchSourceId", value)}
        templateOptions={templates}
        helpText="Built-in source created by an administrator. A connected sourceId input takes precedence."
      />
      <TemplateInput
        label="Document name"
        value={String(options.name ?? "")}
        onChange={(value) => updateOption("name", value)}
        templateOptions={templates}
        helpText="Filename, up to 128 characters. A connected name input takes precedence. Reusing a name replaces its document."
      />
      <p>
        Connect text or JSON to content. Upload requires an administrator workflow owner and queues
        indexing asynchronously.
      </p>
    </>
  )
}
