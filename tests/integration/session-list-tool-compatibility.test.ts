import { describe, expect, it } from "vitest"
import { formatSessionListResponse } from "../../packages/api/src/server/effect/handlers/shared/control-plane/sessions"

describe("session list tool compatibility", () => {
  it("formats sessions with retired stored tool kinds without failing the list", () => {
    const response = formatSessionListResponse({
      sessions: [
        {
          id: "session_legacy",
          session_kind: "agent",
          agent_runtime: "codex",
          source: "web",
          incognito: false,
          title: "Legacy tools",
          repo_owner: "",
          repo_name: "",
          github_installation_id: null,
          github_repo_id: null,
          repo_default_branch: null,
          branch_name: null,
          tools_json: JSON.stringify([
            { kind: "workflow_builder" },
            { kind: "retired_tool", token: "must-not-be-returned" },
          ]),
          custom_mcp_json: null,
          isolate_step_limit: null,
          model: null,
          reasoning_effort: null,
          status: "completed",
          created_at: 1,
          updated_at: 2,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    } as never)

    expect(response.sessions[0]).toMatchObject({
      id: "session_legacy",
      tools: [{ kind: "workflow_builder" }],
      unavailableTools: [{ kind: "retired_tool", reason: "unknown_kind" }],
    })
    expect(JSON.stringify(response)).not.toContain("must-not-be-returned")
  })
})
