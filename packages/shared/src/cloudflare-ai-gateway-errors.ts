export const CLOUDFLARE_AI_GATEWAY_UNIFIED_BILLING_DOCS_URL =
  "https://developers.cloudflare.com/ai-gateway/features/unified-billing/"
export const CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL =
  "https://developers.cloudflare.com/workers-ai/platform/pricing/"
export const CLOUDFLARE_AI_GATEWAY_TOP_UP_URL =
  "https://dash.cloudflare.com/?to=%2F%3Aaccount%2Fai%2Fai-gateway"

export type CloudflareAiGatewayActionableErrorKind =
  | "free_allocation_exhausted"
  | "payment_required"

export interface CloudflareAiGatewayErrorHelp {
  readonly kind: CloudflareAiGatewayActionableErrorKind
  readonly title: string
  readonly description: string
  readonly documentationUrl: string
  readonly topUpUrl: string
  readonly apiMessage: string
}

const FREE_ALLOCATION_ERROR_MARKERS = [
  "3036",
  "daily free allocation",
  "free allocation of 10,000 neurons",
] as const

const PAYMENT_REQUIRED_ERROR_MARKERS = [
  "payment required",
  "no inference credits available",
  "insufficient credits",
] as const

function includesMarker(message: string, markers: readonly string[]): boolean {
  const normalized = message.toLowerCase()
  return markers.some((marker) => normalized.includes(marker))
}

export function classifyCloudflareAiGatewayError(
  message: string,
  status?: number,
): CloudflareAiGatewayActionableErrorKind | null {
  if (includesMarker(message, FREE_ALLOCATION_ERROR_MARKERS)) {
    return "free_allocation_exhausted"
  }
  if (status === 402 || includesMarker(message, PAYMENT_REQUIRED_ERROR_MARKERS)) {
    return "payment_required"
  }
  return null
}

export function getCloudflareAiGatewayErrorHelp(
  message: string,
  status?: number,
): CloudflareAiGatewayErrorHelp | null {
  const kind = classifyCloudflareAiGatewayError(message, status)
  if (kind === "free_allocation_exhausted") {
    const description =
      "The Cloudflare Workers AI daily free allocation has been exhausted. Upgrade to Workers Paid, enable Unified Billing with credits, or switch to a funded model."
    return {
      kind,
      title: "Workers AI free limit reached",
      description,
      documentationUrl: CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL,
      topUpUrl: CLOUDFLARE_AI_GATEWAY_TOP_UP_URL,
      apiMessage: `${description} Documentation: ${CLOUDFLARE_WORKERS_AI_PRICING_DOCS_URL} AI Gateway top up: ${CLOUDFLARE_AI_GATEWAY_TOP_UP_URL}`,
    }
  }
  if (kind === "payment_required") {
    const description =
      "Cloudflare AI Gateway has no inference credits available. Add credits or switch to the Workers AI Starter model."
    return {
      kind,
      title: "Cloudflare AI Gateway needs credits",
      description,
      documentationUrl: CLOUDFLARE_AI_GATEWAY_UNIFIED_BILLING_DOCS_URL,
      topUpUrl: CLOUDFLARE_AI_GATEWAY_TOP_UP_URL,
      apiMessage: `${description} Documentation: ${CLOUDFLARE_AI_GATEWAY_UNIFIED_BILLING_DOCS_URL} Top up: ${CLOUDFLARE_AI_GATEWAY_TOP_UP_URL}`,
    }
  }
  return null
}

export function humanizeCloudflareAiGatewayError(message: string, status?: number): string {
  return getCloudflareAiGatewayErrorHelp(message, status)?.apiMessage ?? message
}
