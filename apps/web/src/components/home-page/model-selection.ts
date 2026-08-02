import type { RuntimeProviderCatalog } from "@c0-agent/shared"

export function getDefaultVisibleModel(
  catalog: Pick<RuntimeProviderCatalog, "defaultModel" | "modelOptions"> | null,
): string {
  const defaultModel = catalog?.defaultModel
  if (!defaultModel) {
    return ""
  }

  return catalog.modelOptions.some((group) =>
    group.models.some((model) => model.id === defaultModel),
  )
    ? defaultModel
    : ""
}
