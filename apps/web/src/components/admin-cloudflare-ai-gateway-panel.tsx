"use client"

import type { AdminCloudflareAiGatewayProviderResponse } from "@solzero/api"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { useMemo } from "react"
import { DocsSectionHeading, EnvLockIcon } from "./admin-ai-provider-panel-ui"

function gatewayStatus(data: AdminCloudflareAiGatewayProviderResponse | undefined) {
  if (!data?.enabled) {
    return { label: "Disabled", ready: false }
  }
  if (!data.bindingConfigured || !data.gatewayId) {
    return { label: "Binding unavailable", ready: false }
  }
  return { label: "Enabled", ready: true }
}

export function AdminCloudflareAiGatewayPanel({
  data,
}: {
  data: AdminCloudflareAiGatewayProviderResponse | undefined
}) {
  const models = useMemo(
    () => Object.values(data?.models ?? {}).sort((a, b) => a.id.localeCompare(b.id)),
    [data?.models],
  )
  const status = gatewayStatus(data)

  return (
    <section className="space-y-10 border-t border-kumo-hairline py-8">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <DocsSectionHeading
            id="cloudflare-ai-gateway-provider"
            level="h2"
            title="Cloudflare AI Gateway"
          />
          <span
            className={`rounded-lg border px-2 py-1 text-xs ${
              status.ready
                ? "border-kumo-success/40 bg-kumo-success-tint/10 text-kumo-success"
                : "border-kumo-line text-kumo-subtle"
            }`}
          >
            {status.label}
          </span>
        </div>
        <p className="max-w-2xl text-sm text-kumo-subtle">
          Cloudflare-hosted models run through a deployment-managed AI Gateway for request logs,
          analytics, caching, and rate controls. Isolates use the native binding; compatible
          container harnesses use Cloudflare Containers outbound interception to inject the scoped
          credential outside the container sandbox.
        </p>
      </div>

      <div className="space-y-5 max-w-2xl">
        <DocsSectionHeading
          id="cloudflare-ai-gateway-settings"
          level="h3"
          title="Settings"
          trailing={<EnvLockIcon envVarName="S0_CONFIG_CLOUDFLARE_AI_GATEWAY" />}
        />
        <dl className="grid gap-4 rounded-lg border border-kumo-hairline bg-kumo-elevated/60 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-kumo-subtle">Gateway ID</dt>
            <dd className="mt-1 break-all text-sm text-kumo-default">
              {data?.gatewayId ?? "Not provisioned"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-kumo-subtle">Request logs</dt>
            <dd className="mt-1 text-sm text-kumo-default">
              {data?.collectLogs ? "Collected" : "Not collected"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-kumo-subtle">Cache</dt>
            <dd className="mt-1 text-sm text-kumo-default">
              {data?.cacheTtl ? `${data.cacheTtl} second TTL` : "Disabled"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-kumo-subtle">Default model</dt>
            <dd className="mt-1 break-all text-sm text-kumo-default">
              {data?.defaultModel ?? "Not configured"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="space-y-4">
        <DocsSectionHeading
          id="cloudflare-ai-gateway-models"
          level="h3"
          title="Models"
          trailing={<span className="text-xs text-kumo-subtle">{models.length} configured</span>}
        />
        <div className="overflow-auto rounded-lg bg-kumo-elevated/80">
          <KumoTable layout="fixed" className="min-w-[680px] text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[38%]" />
              <col />
            </colgroup>
            <KumoTable.Header variant="compact" className="text-kumo-subtle!">
              <KumoTable.Row>
                <KumoTable.Head>Model</KumoTable.Head>
                <KumoTable.Head>Description</KumoTable.Head>
                <KumoTable.Head>Reasoning</KumoTable.Head>
              </KumoTable.Row>
            </KumoTable.Header>
            <KumoTable.Body>
              {models.map((model) => (
                <KumoTable.Row key={model.id}>
                  <KumoTable.Cell>
                    <div className="font-medium text-kumo-default">{model.name}</div>
                    <div className="break-all text-xs text-kumo-subtle">{model.id}</div>
                  </KumoTable.Cell>
                  <KumoTable.Cell className="text-kumo-subtle">
                    {model.description || "—"}
                  </KumoTable.Cell>
                  <KumoTable.Cell className="text-kumo-subtle">
                    {model.reasoningEfforts.length > 0 ? model.reasoningEfforts.join(", ") : "—"}
                  </KumoTable.Cell>
                </KumoTable.Row>
              ))}
            </KumoTable.Body>
          </KumoTable>
        </div>
      </div>
    </section>
  )
}
