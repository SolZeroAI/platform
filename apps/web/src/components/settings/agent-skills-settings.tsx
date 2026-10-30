"use client"

import { AgentSkillParams, AgentSkillPreferencePayload, type AgentSkillItem } from "@solzero/api"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Switch } from "@cloudflare/kumo/components/switch"
import { RotateCcw } from "lucide-react"
import { useState } from "react"
import { getErrorMessage } from "@/lib/admin-console-actions"
import { runApi } from "@/lib/api-client"
import { showErrorToast } from "@/lib/toast-manager"
import { SettingsDocsLayout, SettingsDocsSectionHeading } from "./settings-docs-layout"

const SKILLS_TOC_ITEMS = [{ id: "global-agent-skills", label: "Global skills" }] as const

export function AgentSkillsSettings({
  initialSkills,
}: {
  initialSkills: readonly AgentSkillItem[]
}) {
  const [skills, setSkills] = useState(initialSkills)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)

  const setPreference = async (skill: AgentSkillItem, enabled: boolean) => {
    setBusySkillId(skill.id)

    try {
      const response = await runApi(
        (client) =>
          client.skills.setPreference({
            params: new AgentSkillParams({ skillId: skill.id }),
            payload: new AgentSkillPreferencePayload({ enabled }),
          }),
        { fallbackMessage: "Failed to update the skill" },
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
      const response = await runApi(
        (client) =>
          client.skills.clearPreference({ params: new AgentSkillParams({ skillId: skill.id }) }),
        { fallbackMessage: "Failed to reset the skill" },
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

        {skills.length === 0 ? (
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
