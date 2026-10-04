import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"

type Skill = {
  id: string
  name: string
  enabled: boolean
  defaultEnabled: boolean
  overridden: boolean
}

test(
  "global skill defaults and per-user preferences persist independently",
  { session: "admin" },
  async ({ app, browser, screen, agent }) => {
    const name = uniqueName("e2e-skill")
    const added = await api<{ skills: Skill[] }>(browser, "/admin/skills", "POST", {
      skillMd: `---\nname: ${name}\ndescription: Disposable end-to-end skill\n---\nOnly use in the e2e deployment.`,
      defaultEnabled: true,
    })
    const skill = added.skills.find((item) => item.name === name)!
    expect(skill).toBeDefined()
    try {
      await app.open("/admin/integrations?integrationTab=skills")
      await expect(screen.getByText(name, { exact: true })).toBeVisible()
      await app.open("/settings?category=agents&tab=skills")
      await expect(screen.getByRole("switch", `Enable ${name}`)).toBeChecked()
      await agent.act(
        "Turn off the Enable switch for the supplied skill. Finish when the Use admin default button is visible beside this skill; leave that button untouched.",
        { params: { name } },
      )
      await expect(screen.getByRole("switch", `Enable ${name}`)).not.toBeChecked()
      await browser.reload()
      await expect(screen.getByRole("switch", `Enable ${name}`)).not.toBeChecked()
      const prefs = await api<{ skills: Skill[] }>(browser, "/skills")
      expect(prefs.skills.find((item) => item.id === skill.id)).toMatchObject({
        enabled: false,
        defaultEnabled: true,
        overridden: true,
      })
      await api(browser, `/skills/${skill.id}/preference`, "DELETE")
      await browser.reload()
      await expect(screen.getByRole("switch", `Enable ${name}`)).toBeChecked()
    } finally {
      await api(browser, `/admin/skills/${skill.id}`, "DELETE")
    }
  },
)
