"use client"

import { SecretsEditor } from "@/components/secrets-editor"
import { Button } from "@cloudflare/kumo/components/button"
import { LayerCard } from "@cloudflare/kumo/components/layer-card"
import { PlusIcon } from "lucide-react"
import { useCallback, useRef } from "react"

export function SecretsSettings() {
  const addSecretRef = useRef<(() => void) | null>(null)
  const registerAddSecret = useCallback((openCreateDialog: () => void) => {
    addSecretRef.current = openCreateDialog
  }, [])

  return (
    <section className="mb-8">
      <div className="mb-8">
        <h3 className="text-base font-medium text-kumo-default mb-2">
          Secrets to share with your Agents and Workflows
        </h3>
        <p className="text-sm text-kumo-subtle mb-3">
          Use tags to organize and logically group secrets. Agents and Workflows which reference
          specific Tag(s) will inherit all secrets with those tags.
        </p>
      </div>
      <LayerCard>
        <LayerCard.Secondary className="flex items-center justify-between">
          <span>Secrets</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Add secret"
            onClick={() => addSecretRef.current?.()}
          >
            <span>Add secret</span>
            <PlusIcon size={16} />
          </Button>
          {/* <span className="text-xs font-medium">
            Secrets to share with your Agents and Workflows
          </span> */}
        </LayerCard.Secondary>
        <LayerCard.Primary>
          <SecretsEditor onRegisterAddSecret={registerAddSecret} />
        </LayerCard.Primary>
      </LayerCard>
    </section>
  )
}
