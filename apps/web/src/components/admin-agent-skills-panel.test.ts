import { describe, expect, it } from "vitest"
import { validateSkillMarkdownEditor } from "./admin-agent-skills-panel"

describe("global skill editor validation", () => {
  it("accepts a complete SKILL.md and reports inline validation errors", () => {
    expect(
      validateSkillMarkdownEditor(
        "---\nname: review-code\ndescription: Review code when asked.\n---\n\nInspect the diff.",
      ),
    ).toBeNull()
    expect(validateSkillMarkdownEditor("plain text")).toContain("frontmatter")
    expect(
      validateSkillMarkdownEditor(
        "---\nname: Review Code\ndescription: Review code when asked.\n---\nBody",
      ),
    ).toContain("kebab-case")
    expect(validateSkillMarkdownEditor("---\nname: review-code\n---\nBody")).toContain(
      "description",
    )
  })
})
