import { createKumoToastManager } from "@cloudflare/kumo/components/toast"

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

export function showWarningToast(title: string, options?: ErrorToastOptions) {
  appToastManager.add({
    title,
    description: options?.description,
    variant: "warning",
    timeout: options?.timeout ?? 8000,
    actions: options?.actions,
  })
}
