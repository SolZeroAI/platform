import { createKumoToastManager } from "@cloudflare/kumo/components/toast"
import { getCloudflareAiGatewayErrorHelp } from "@solzero/shared"

export const appToastManager = createKumoToastManager()

type ErrorToastOptions = {
  description?: string
  timeout?: number
  actions?: NonNullable<Parameters<typeof appToastManager.add>[0]["actions"]>
}

export function showErrorToast(title: string, options?: ErrorToastOptions) {
  appToastManager.add({
    title,
    description: options?.description,
    variant: "error",
    timeout: options?.timeout ?? 8000,
    actions: options?.actions,
  })
}

export function showActionableErrorToast(message: string) {
  const help = getCloudflareAiGatewayErrorHelp(message)
  if (!help) {
    showErrorToast(message)
    return
  }

  showErrorToast(help.title, {
    description: help.description,
    timeout: 15_000,
    actions: [
      {
        children: "Top up",
        size: "sm",
        onClick: () => {
          window.open(help.topUpUrl, "_blank", "noopener,noreferrer")
        },
      },
      {
        children: "Documentation",
        size: "sm",
        onClick: () => {
          window.open(help.documentationUrl, "_blank", "noopener,noreferrer")
        },
      },
    ],
  })
}

export function showWarningToast(title: string, options?: ErrorToastOptions) {
  appToastManager.add({
    title,
    description: options?.description,
    variant: "warning",
    timeout: options?.timeout ?? 8000,
    actions: options?.actions,
  })
}
