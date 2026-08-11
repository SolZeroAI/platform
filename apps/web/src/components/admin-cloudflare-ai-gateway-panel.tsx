"use client"

import type {
  AdminCloudflareAiGatewayProviderKeysPayload,
  AdminCloudflareAiGatewayProviderResponse,
} from "@solzero/api"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { ExternalLink, Save, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { DocsSectionHeading, EnvLockIcon, Field } from "./admin-ai-provider-panel-ui"

const CLOUDFLARE_AI_GATEWAY_CONFIG_ENV_VAR = "S0_CONFIG_CLOUDFLARE_AI_GATEWAY"
const CLOUDFLARE_AI_GATEWAY_DOCS_URL = "https://developers.cloudflare.com/ai-gateway/"
const CLOUDFLARE_AI_GATEWAY_BYOK_DOCS_URL =
  "https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/"

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
          <div className="flex items-center gap-2">
            <EnvLockIcon envVarName={CLOUDFLARE_AI_GATEWAY_CONFIG_ENV_VAR} />
            <Switch
              aria-label="Enabled"
              checked={Boolean(data?.enabled)}
              onCheckedChange={() => undefined}
              size="sm"
              disabled
            />
          </div>
        </div>
        <p className="max-w-2xl text-sm text-kumo-subtle">
          Documentation:{" "}
          <a
            href={CLOUDFLARE_AI_GATEWAY_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-kumo-brand transition hover:text-kumo-default"
          >
            <span className="underline underline-offset-2">Cloudflare AI Gateway</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </a>
        </p>
      </div>

      <div className="space-y-5 max-w-2xl">
        <DocsSectionHeading
          id="cloudflare-ai-gateway-settings"
          level="h3"
          title="Settings"
          trailing={<EnvLockIcon envVarName={CLOUDFLARE_AI_GATEWAY_CONFIG_ENV_VAR} />}
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
          Documentation:{" "}
          <a
            href={CLOUDFLARE_AI_GATEWAY_BYOK_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-kumo-brand transition hover:text-kumo-default"
          >
            <span className="underline underline-offset-2">Cloudflare AI Gateway BYOK</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </a>
        </p>
        <div className="space-y-5">
          {(data?.providerKeys ?? []).map((provider) => {
            const cleared = clearedProviderIds.has(provider.providerId)
            const configured = provider.configured && !cleared
            return (
              <div key={provider.providerId} className="space-y-2">
                <Field
                  label={
                    configured && !provider.locked
                      ? `Replace ${provider.name} API key`
                      : `${provider.name} API key`
                  }
                  value={keyDrafts[provider.providerId] ?? ""}
                  onChange={(value) => {
                    setKeyDrafts((current) => ({
                      ...current,
                      [provider.providerId]: value,
                    }))
                    setClearedProviderIds((current) => {
                      const next = new Set(current)
                      next.delete(provider.providerId)
                      return next
                    })
                  }}
                  placeholder={
                    provider.locked
                      ? "Configured from environment"
                      : configured
                        ? "Key configured"
                        : cleared
                          ? "Key will be removed"
                          : "Enter API key"
                  }
                  type={provider.locked ? "text" : "password"}
                  disabled={provider.locked}
                  disabledEnvVarName={provider.envVarName}
                />
                {!provider.locked && provider.source === "admin" && !cleared ? (
                  <div className="flex justify-end">
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
                  </div>
                ) : null}
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
          trailing={
            <div className="flex items-center gap-2">
              <EnvLockIcon envVarName={CLOUDFLARE_AI_GATEWAY_CONFIG_ENV_VAR} />
              <span className="text-xs text-kumo-subtle">{models.length} configured</span>
            </div>
          }
        />
        <div className="overflow-auto rounded-lg bg-kumo-elevated/80">
          <KumoTable layout="fixed" className="min-w-[520px] text-sm">
            <colgroup>
              <col className="w-[60%]" />
              <col />
            </colgroup>
            <KumoTable.Header variant="compact" className="text-kumo-subtle!">
              <KumoTable.Row>
                <KumoTable.Head>Model</KumoTable.Head>
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
