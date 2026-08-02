"use client"

import type { AgentSkillItem, AgentSkillsResponse } from "@c0/api"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { C0Loader } from "@/components/c0-loader"
import { getErrorMessage, requestJson } from "@/lib/admin-console-actions"
import { showErrorToast } from "@/lib/toast-manager"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const SKILLS_TOC_ITEMS = [{ id: "global-agent-skills", label: "Global skills" }] as const

export function AgentSkillsSettings() {
  const [skills, setSkills] = useState<readonly AgentSkillItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    try {
      const response = await requestJson<AgentSkillsResponse>("/api/skills")
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

  const setPreference = async (skill: AgentSkillItem, enabled: boolean) => {
    setBusySkillId(skill.id)
    try {
      const response = await requestJson<AgentSkillsResponse>(
        `/api/skills/${encodeURIComponent(skill.id)}/preference`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      )
      setSkills(response.skills)
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setBusySkillId(null)
    }
  }

  const resetPreference = async (skill: AgentSkillItem) => {
    setBusySkillId(skill.id)
    try {
      const response = await requestJson<AgentSkillsResponse>(
        `/api/skills/${encodeURIComponent(skill.id)}/preference`,
        { method: "DELETE" },
      )
      setSkills(response.skills)
    } catch (error) {
      showErrorToast(getErrorMessage(error))
    } finally {
      setBusySkillId(null)
    }
  }

  return (
    <SettingsDocsLayout
      title="Agent skills"
      titleId="agent-skills"
      description="Choose the global skills available to your OpenCode, Codex, and Claude Code sessions."
      tocItems={SKILLS_TOC_ITEMS}
    >
      <section className="scroll-mt-28 space-y-5" aria-labelledby="global-agent-skills">
        <SettingsDocsSectionHeading id="global-agent-skills" level="h2" title="Global skills" />

        {loading ? (
          <div className="flex min-h-32 items-center justify-center rounded-lg bg-kumo-elevated/80">
            <C0Loader size={32} />
          </div>
        ) : skills.length === 0 ? (
          <p className="rounded-lg bg-kumo-elevated/80 px-4 py-8 text-center text-sm text-kumo-subtle">
            No global agent skills are available.
          </p>
        ) : (
          <div className="divide-y divide-kumo-hairline overflow-hidden rounded-lg bg-kumo-elevated/80">
            {skills.map((skill) => (
              <div key={skill.id} className="flex flex-wrap items-center justify-between gap-5 p-5">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-kumo-default">{skill.name}</h3>
                    <Badge variant="secondary">
                      Admin default: {skill.defaultEnabled ? "on" : "off"}
                    </Badge>
                    {skill.overridden ? <Badge variant="warning">Override</Badge> : null}
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-kumo-subtle">
                    {skill.description}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {skill.overridden ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                      loading={busySkillId === skill.id}
                      disabled={busySkillId !== null}
                      onClick={() => void resetPreference(skill)}
                    >
                      Use admin default
                    </Button>
                  ) : null}
                  <Switch
                    size="sm"
                    checked={skill.enabled}
                    disabled={busySkillId !== null}
                    aria-label={`Enable ${skill.name}`}
                    onCheckedChange={(enabled) => void setPreference(skill, enabled)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </SettingsDocsLayout>
  )
}
