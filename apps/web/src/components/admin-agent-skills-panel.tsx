"use client"

import type { AdminAgentSkillItem, AdminAgentSkillsResponse } from "@solzero/api"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { Table as KumoTable } from "@cloudflare/kumo/components/table"
import { Plus, Save, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState, type ReactNode } from "react"
import { S0Loader, TableCellState } from "@/components/s0-loader"
import { CodeEditor } from "@/components/code"
import { Dialog } from "@/components/ui/dialog"
import { getErrorMessage, requestJson } from "@/lib/admin-console-actions"
import { appToastManager, showErrorToast } from "@/lib/toast-manager"

const NEW_SKILL_TEMPLATE = `---
name: my-skill
description: Use when an agent should perform this specific workflow.
---

# My skill

Follow these steps:

1. Inspect the current state.
2. Perform the requested work.
3. Verify and report the outcome.
`

export function AdminAgentSkillsPanel({
  onHeaderActionsChange,
}: {
  onHeaderActionsChange?: (actions: ReactNode | null) => void
}) {
  const [skills, setSkills] = useState<readonly AdminAgentSkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [skillMd, setSkillMd] = useState(NEW_SKILL_TEMPLATE)
  const [defaultEnabled, setDefaultEnabled] = useState(true)
  const [validationError, setValidationError] = useState("")
  const [pendingDelete, setPendingDelete] = useState<AdminAgentSkillItem | null>(null)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    try {
      const response = await requestJson<AdminAgentSkillsResponse>("/api/admin/skills")
      setSkills(response.skills)
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  useEffect(() => {
    onHeaderActionsChange?.(
      <Button
        type="button"
        variant="secondary"
        icon={<Plus className="h-4 w-4" aria-hidden />}
        onClick={() => setCreateOpen(true)}
      >
        Add skill
      </Button>,
    )
    return () => onHeaderActionsChange?.(null)
  }, [onHeaderActionsChange])

  const createSkill = async () => {
    const editorError = validateSkillMarkdownEditor(skillMd)
    if (editorError) {
      setValidationError(editorError)
      return
    }

    setBusySkillId("create")
    setValidationError("")
    try {
      const response = await requestJson<AdminAgentSkillsResponse>("/api/admin/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillMd, defaultEnabled }),
      })
      setSkills(response.skills)
      setCreateOpen(false)
      setSkillMd(NEW_SKILL_TEMPLATE)
      setDefaultEnabled(true)
      appToastManager.add({ title: "Global skill added", timeout: 4000 })
    } catch (error) {
      setValidationError(getErrorMessage(error))
    } finally {
      setBusySkillId(null)
    }
  }

  const updateDefault = async (skill: AdminAgentSkillItem, enabled: boolean) => {
    setBusySkillId(skill.id)
    try {
      const response = await requestJson<AdminAgentSkillsResponse>(
        `/api/admin/skills/${encodeURIComponent(skill.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultEnabled: enabled }),
        },
      )
      setSkills(response.skills)
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setBusySkillId(null)
    }
  }

  const deleteSkill = async () => {
    if (!pendingDelete) {
      return
    }
    setBusySkillId(pendingDelete.id)
    try {
      const response = await requestJson<AdminAgentSkillsResponse>(
        `/api/admin/skills/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE" },
      )
      setSkills(response.skills)
      setPendingDelete(null)
      appToastManager.add({ title: "Global skill deleted", timeout: 4000 })
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setBusySkillId(null)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-kumo-default">Skills</h1>
        <p className="max-w-3xl text-lg text-kumo-strong">
          Manage the global skills available to OpenCode, Codex, and Claude Code sessions.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg bg-kumo-elevated/80">
        <KumoTable layout="fixed" className="w-full text-sm">
          <colgroup>
            <col className="w-[48%]" />
            <col className="w-[17%]" />
            <col className="w-[20%]" />
            <col />
          </colgroup>
          <KumoTable.Header variant="compact" className="text-kumo-subtle!">
            <KumoTable.Row>
              <KumoTable.Head>Skill</KumoTable.Head>
              <KumoTable.Head>Origin</KumoTable.Head>
              <KumoTable.Head>Default</KumoTable.Head>
              <KumoTable.Head>Actions</KumoTable.Head>
            </KumoTable.Row>
          </KumoTable.Header>
          <KumoTable.Body>
            {skills.length === 0 ? (
              <KumoTable.Row>
                <KumoTable.Cell colSpan={4} className="h-32 text-kumo-subtle">
                  <TableCellState className="h-full">
                    {loading ? <S0Loader size={32} /> : "No global skills configured."}
                  </TableCellState>
                </KumoTable.Cell>
              </KumoTable.Row>
            ) : (
              skills.map((skill) => (
                <KumoTable.Row key={skill.id}>
                  <KumoTable.Cell className="align-middle">
                    <div className="font-medium text-kumo-default">{skill.name}</div>
                    <div className="mt-1 text-xs leading-5 text-kumo-subtle">
                      {skill.description}
                    </div>
                  </KumoTable.Cell>
                  <KumoTable.Cell className="align-middle">
                    <Badge variant="secondary">{formatOrigin(skill.origin)}</Badge>
                  </KumoTable.Cell>
                  <KumoTable.Cell className="align-middle">
                    <div className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        checked={skill.defaultEnabled}
                        disabled={busySkillId !== null}
                        aria-label={`Enable ${skill.name} by default`}
                        onCheckedChange={(enabled) => void updateDefault(skill, enabled)}
                      />
                      <span className="text-xs text-kumo-subtle">
                        {skill.defaultEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </KumoTable.Cell>
                  <KumoTable.Cell className="align-middle">
                    <Button
                      type="button"
                      size="sm"
                      shape="circle"
                      variant="secondary-destructive"
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      aria-label={`Delete ${skill.name}`}
                      loading={busySkillId === skill.id && pendingDelete?.id === skill.id}
                      disabled={busySkillId !== null}
                      onClick={() => setPendingDelete(skill)}
                    />
                  </KumoTable.Cell>
                </KumoTable.Row>
              ))
            )}
          </KumoTable.Body>
        </KumoTable>
      </div>

      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          if (busySkillId === "create") {
            return
          }
          setCreateOpen(open)
          if (!open) {
            setValidationError("")
          }
        }}
      >
        <Dialog className="flex max-h-[88dvh] w-full max-w-4xl flex-col bg-kumo-canvas p-0">
          <div className="flex items-start justify-between gap-4 border-b border-kumo-hairline px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-kumo-default">
                Add global skill
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                Define a SKILL.md with required name and description frontmatter.
              </Dialog.Description>
            </div>
            <Button
              type="button"
              variant="ghost"
              shape="circle"
              icon={<X className="h-4 w-4" aria-hidden />}
              aria-label="Close add skill dialog"
              onClick={() => setCreateOpen(false)}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {validationError ? (
              <p role="alert" className="text-sm text-kumo-error">
                {validationError}
              </p>
            ) : null}
            <div className="h-[52dvh] overflow-hidden rounded-md border border-kumo-line">
              <CodeEditor
                value={skillMd}
                language="text"
                onChange={(value) => {
                  setSkillMd(value)
                  setValidationError("")
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kumo-hairline px-5 py-4">
            <div className="flex items-center gap-2">
              <Switch
                size="sm"
                checked={defaultEnabled}
                onCheckedChange={setDefaultEnabled}
                aria-label="Enable new skill by default"
              />
              <span className="text-sm text-kumo-subtle">Enabled by default</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                icon={<Save className="h-4 w-4" aria-hidden />}
                loading={busySkillId === "create"}
                disabled={busySkillId !== null}
                onClick={() => void createSkill()}
              >
                Add skill
              </Button>
            </div>
          </div>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root
        open={pendingDelete !== null}
        role="alertdialog"
        onOpenChange={(open) => {
          if (!open && busySkillId === null) {
            setPendingDelete(null)
          }
        }}
      >
        <Dialog className="flex w-full max-w-md flex-col p-0">
          <div className="border-b border-kumo-hairline px-5 py-4">
            <Dialog.Title className="text-lg font-semibold text-kumo-default">
              Delete global skill?
            </Dialog.Title>
          </div>
          <Dialog.Description className="px-5 py-4 text-sm leading-5 text-kumo-subtle">
            This removes {pendingDelete?.name ?? "this skill"} from all future agent prompts and
            clears user overrides. This action cannot be undone.
          </Dialog.Description>
          <div className="flex justify-end gap-2 border-t border-kumo-hairline px-5 py-4">
            <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary-destructive"
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              loading={pendingDelete !== null && busySkillId === pendingDelete.id}
              disabled={pendingDelete === null || busySkillId !== null}
              onClick={() => void deleteSkill()}
            >
              Delete skill
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}

function formatOrigin(origin: AdminAgentSkillItem["origin"]): string {
  return origin === "built-in" ? "Built-in" : origin === "skills-sh" ? "skills.sh" : "Admin"
}

export function validateSkillMarkdownEditor(value: string): string | null {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/u.exec(value.trim())
  if (!match) {
    return "SKILL.md must begin with YAML frontmatter delimited by ---."
  }
  const frontmatter = match[1] ?? ""
  const body = match[2]?.trim() ?? ""
  const name = /^name:\s*([^\n]+)$/mu.exec(frontmatter)?.[1]?.trim()
  const description = /^description:\s*([^\n]+)$/mu.exec(frontmatter)?.[1]?.trim()
  if (!name) {
    return "Frontmatter must include name."
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    return "Skill name must use kebab-case."
  }
  if (!description) {
    return "Frontmatter must include description."
  }
  if (!body) {
    return "SKILL.md must include a non-empty body."
  }
  return null
}
