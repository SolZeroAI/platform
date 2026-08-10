"use client"

import type {
  AdminCloudflareAiGatewayProviderKeysPayload,
  AdminCloudflareAiGatewayProviderResponse,
} from "@solzero/api"
import { Button } from "@cloudflare/kumo/components/button"
import { InputGroup } from "@cloudflare/kumo/components/input-group"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Save, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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
  onSave,
  saving,
}: {
  data: AdminCloudflareAiGatewayProviderResponse | undefined
  onSave: (payload: AdminCloudflareAiGatewayProviderKeysPayload) => Promise<boolean>
  saving: boolean
}) {
  const models = useMemo(
    () => Object.values(data?.models ?? {}).sort((a, b) => a.id.localeCompare(b.id)),
    [data?.models],
  )
  const status = gatewayStatus(data)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [clearedProviderIds, setClearedProviderIds] = useState<ReadonlySet<string>>(new Set())
  const keyDirty =
    Object.values(keyDrafts).some((value) => value.trim().length > 0) || clearedProviderIds.size > 0

  useEffect(() => {
    setKeyDrafts({})
    setClearedProviderIds(new Set())
  }, [data?.providerKeys])

  const saveProviderKeys = async () => {
    const saved = await onSave({
      keys: (data?.providerKeys ?? []).flatMap((provider) => {
        const apiKey = keyDrafts[provider.providerId]?.trim() ?? ""
        const clearApiKey = clearedProviderIds.has(provider.providerId)
        return apiKey || clearApiKey
          ? [
              {
                providerId: provider.providerId,
                ...(apiKey ? { apiKey } : {}),
                ...(clearApiKey ? { clearApiKey: true } : {}),
              },
            ]
          : []
      }),
    })
    if (saved) {
      setKeyDrafts({})
      setClearedProviderIds(new Set())
    }
  }

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
            <dt className="text-xs font-medium text-kumo-subtle">Secrets Store</dt>
            <dd className="mt-1 text-sm text-kumo-default">
              {data?.secretsStoreConfigured ? "Attached" : "Not attached"}
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

      <div className="space-y-4 max-w-2xl">
        <DocsSectionHeading
          id="cloudflare-ai-gateway-provider-keys"
          level="h3"
          title="Provider Keys"
          trailing={
            keyDirty ? (
              <Button
                type="button"
                size="sm"
                variant="primary"
                loading={saving}
                disabled={saving}
                icon={<Save className="h-4 w-4" aria-hidden />}
                onClick={() => void saveProviderKeys()}
              >
                Save keys
              </Button>
            ) : null
          }
        />
        <p className="text-sm text-kumo-subtle">
          Deployment keys are stored in the attached Cloudflare Secrets Store. Keys entered here are
          encrypted in SolZero and sent through AI Gateway only for the matching provider. Users can
          override each key from their personal provider settings.
        </p>
        <div className="space-y-3">
          {(data?.providerKeys ?? []).map((provider) => {
            const cleared = clearedProviderIds.has(provider.providerId)
            const configured = provider.configured && !cleared
            return (
              <div
                key={provider.providerId}
                className="space-y-2 rounded-lg border border-kumo-hairline bg-kumo-elevated/60 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-kumo-default">{provider.name}</div>
                    <div className="text-xs text-kumo-subtle">
                      {configured
                        ? provider.source === "deployment"
                          ? "Configured by deployment"
                          : "Global key configured"
                        : cleared
                          ? "Will be removed"
                          : "Not configured"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {provider.locked ? <EnvLockIcon envVarName={provider.envVarName} /> : null}
                    {!provider.locked && provider.source === "admin" && !cleared ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                        onClick={() => {
                          setKeyDrafts((current) => ({ ...current, [provider.providerId]: "" }))
                          setClearedProviderIds(
                            (current) => new Set([...current, provider.providerId]),
                          )
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                <InputGroup size="sm">
                  <InputGroup.Input
                    type="password"
                    aria-label={`${provider.name} API key`}
                    readOnly={provider.locked}
                    className={provider.locked ? "pointer-events-none opacity-50" : undefined}
                    value={keyDrafts[provider.providerId] ?? ""}
                    placeholder={
                      provider.locked
                        ? "Configured from environment"
                        : configured
                          ? "Enter a replacement key"
                          : "Enter API key"
                    }
                    onChange={(event) => {
                      setKeyDrafts((current) => ({
                        ...current,
                        [provider.providerId]: event.target.value,
                      }))
                      setClearedProviderIds((current) => {
                        const next = new Set(current)
                        next.delete(provider.providerId)
                        return next
                      })
                    }}
                  />
                </InputGroup>
              </div>
            )
          })}
        </div>
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
