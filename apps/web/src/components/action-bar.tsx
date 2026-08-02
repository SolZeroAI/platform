"use client"

import { Button } from "@cloudflare/kumo/components/button"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown"
import {
  Archive,
  Bug,
  ExternalLink,
  FolderGit2,
  KeyRound,
  Link2,
  MoreVertical,
  Play,
  Square,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Dialog } from "@/components/ui/dialog"
import type { Artifact } from "@/types/session"

interface SessionMoreActionsMenuProps {
  sessionId: string
  sessionStatus: string
  artifacts: Artifact[]
  secretKeys?: readonly string[]
  repoFullName?: string | null
  onArchive?: () => Promise<void> | void
  onUnarchive?: () => Promise<void> | void
  showDebugMenu?: boolean
  isReplaying?: boolean
  onReplay?: () => void
  onStopReplay?: () => void
  onTestError?: () => void
  disabled?: boolean
}

export function SessionMoreActionsMenu({
  sessionId,
  sessionStatus,
  artifacts,
  secretKeys = [],
  repoFullName,
  onArchive,
  onUnarchive,
  showDebugMenu,
  isReplaying,
  onReplay,
  onStopReplay,
  onTestError,
  disabled,
}: SessionMoreActionsMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false)

  const prArtifact = artifacts.find((a) => a.type === "pr")
  const attachedSecretKeys = [...secretKeys].sort((left, right) => left.localeCompare(right))
  const isArchived = sessionStatus === "archived"

  useEffect(() => {
    if (isArchived) {
      setIsArchiveConfirmOpen(false)
    }
  }, [isArchived])

  const handleArchiveToggle = async () => {
    if (!isArchived && onArchive) {
      setIsArchiveConfirmOpen(true)
      return
    }

    setIsArchiving(true)
    try {
      if (isArchived && onUnarchive) {
        await onUnarchive()
      }
    } finally {
      setIsArchiving(false)
    }
  }

  const handleConfirmArchive = async () => {
    if (!onArchive) {
      return
    }

    setIsArchiveConfirmOpen(false)
    setIsArchiving(true)
    try {
      await onArchive()
    } finally {
      setIsArchiving(false)
    }
  }

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/session/${sessionId}`
    await navigator.clipboard.writeText(url)
    setIsMenuOpen(false)
  }

  const archiveDialogOpen = isArchiveConfirmOpen && !isArchived
  const showReplayAction = Boolean(isReplaying ? onStopReplay : onReplay)
  const showTestErrorAction = Boolean(onTestError)
  const menuItems = [
    {
      key: "copy-link",
      icon: <Link2 className="h-4 w-4 mr-2" aria-hidden />,
      label: "Copy link",
      variant: "default" as const,
      onClick: () => {
        void handleCopyLink()
      },
    },
    {
      key: "archive",
      icon: <Archive className="h-4 w-4 mr-2" aria-hidden />,
      label: isArchived ? "Unarchive" : "Archive",
      variant: "default" as const,
      disabled: isArchiving,
      onClick: () => {
        setIsMenuOpen(false)
        void handleArchiveToggle()
      },
    },
  ]

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenu.Trigger>
          <Button
            type="button"
            shape="circle"
            variant="ghost"
            disabled={disabled}
            aria-label="More actions"
            title="More actions"
            icon={<MoreVertical className="h-4 w-4" aria-hidden />}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="top" align="start">
          {showDebugMenu && (showReplayAction || showTestErrorAction) && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <span className="inline-flex items-center gap-2 mr-2">
                  <Bug className="h-4 w-4 shrink-0" aria-hidden />
                  Debug
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                {showReplayAction && (
                  <DropdownMenu.Item
                    icon={
                      isReplaying ? (
                        <Square className="h-4 w-4 mr-2" aria-hidden />
                      ) : (
                        <Play className="h-4 w-4 mr-2" aria-hidden />
                      )
                    }
                    onClick={() => {
                      if (isReplaying) {
                        onStopReplay?.()
                      } else {
                        onReplay?.()
                      }
                      setIsMenuOpen(false)
                    }}
                  >
                    {isReplaying ? "Stop replay" : "Replay"}
                  </DropdownMenu.Item>
                )}
                {showTestErrorAction && (
                  <DropdownMenu.Item
                    icon={<Bug className="h-4 w-4 mr-2" aria-hidden />}
                    variant="danger"
                    onClick={() => {
                      onTestError?.()
                      setIsMenuOpen(false)
                    }}
                  >
                    Test Error
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          )}
          {menuItems.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              icon={item.icon}
              variant={item.variant}
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
          {(prArtifact?.url || repoFullName) && (
            <>
              <DropdownMenu.Separator />
              {prArtifact?.url && (
                <DropdownMenu.LinkItem
                  href={prArtifact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={<ExternalLink className="h-4 w-4 mr-2" aria-hidden />}
                  onClick={() => setIsMenuOpen(false)}
                >
                  View in GitHub
                </DropdownMenu.LinkItem>
              )}
              {repoFullName && (
                <DropdownMenu.LinkItem
                  href={`https://github.com/${repoFullName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={<FolderGit2 className="h-4 w-4 mr-2" aria-hidden />}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {repoFullName}
                </DropdownMenu.LinkItem>
              )}
            </>
          )}
          <DropdownMenu.Separator />
          {attachedSecretKeys.length === 0 ? (
            <DropdownMenu.Item disabled>No secrets attached</DropdownMenu.Item>
          ) : (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <span className="inline-flex items-center gap-2 mr-2">
                  <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
                  {attachedSecretKeys.length === 0
                    ? "Secrets attached"
                    : `Secrets attached (${attachedSecretKeys.length})`}
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                {attachedSecretKeys.length === 0 ? (
                  <DropdownMenu.Item disabled>No secrets attached</DropdownMenu.Item>
                ) : (
                  attachedSecretKeys.map((secretKey) => (
                    <DropdownMenu.Item key={secretKey} disabled>
                      {secretKey}
                    </DropdownMenu.Item>
                  ))
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          )}
        </DropdownMenu.Content>
      </DropdownMenu>

      <ArchiveSessionDialog
        open={archiveDialogOpen}
        isArchiving={isArchiving}
        onOpenChange={(open) => {
          if (!open) {
            setIsArchiveConfirmOpen(false)
          }
        }}
        onCancel={() => setIsArchiveConfirmOpen(false)}
        onConfirm={() => void handleConfirmArchive()}
      />
    </>
  )
}

function ArchiveSessionDialog({
  open,
  isArchiving,
  onOpenChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  isArchiving: boolean
  onOpenChange: (open: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} role="alertdialog">
      <Dialog size="sm">
        <Dialog.Title>Archive this agent?</Dialog.Title>
        <Dialog.Description className="mt-2">
          This agent will be archived. You can restore archived agents later.
        </Dialog.Description>
        <div className="mt-4 space-y-3 text-sm text-kumo-subtle">
          <p>
            If it is attached to a workflow, the workflow will continue to exist and can create a
            new agent on its next execution.
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onCancel} disabled={isArchiving} variant="ghost">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isArchiving}
            loading={isArchiving}
            variant="secondary-destructive"
          >
            Archive
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
