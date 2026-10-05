import { test } from "@e2e-dev/web"
import { expect } from "e2e"
import { api, uniqueName } from "./support/api"
import { requireFixture } from "./support/external-fixtures"
import { verifyExplicitNativeLimit } from "./support/native-provider"

for (const runtime of ["opencode", "codex"] as const) {
  test(
    `${runtime} executes multiple shell tools, follows up, and persists both turns`,
    { session: "admin", tags: ["harness", "harness-tools"] },
    async ({ app, browser, screen }) => {
      requireFixture("E2E_CONTAINER_RUNTIME")
      const title = uniqueName(`e2e-${runtime}-tool`)
      const shellOutput = (result: string) => {
        if (runtime === "opencode") return result
        const command = JSON.parse(result) as { exitCode: number; output: string }
        expect(command.exitCode).toBe(0)
        return command.output
      }
      const marker = uniqueName("E2E_TOOL_OUTPUT")
      const file = `/workspace/repo/${uniqueName("s0-e2e-tool")}.txt`
      const otherMarker = uniqueName("E2E_PARALLEL_OUTPUT")
      const otherFile = `/workspace/repo/${uniqueName("s0-e2e-tool")}.txt`
      const model = process.env[`E2E_${runtime.toUpperCase()}_MODEL`] ?? process.env.E2E_APP_MODEL
      const first = await api<{
        sessionId: string
        messageId: string
        status: string
        output: string
        error?: string
      }>(browser, "/sessions/run", "POST", {
        title,
        agentRuntime: runtime,
        reasoningEffort: "low",
        ...(model ? { model } : {}),
        content: `Execute these two shell commands in order, one tool call per command. First command: printf '%s' '${marker}' > '${file}' && cat '${file}'. Second command: printf '%s' '${otherMarker}' > '${otherFile}' && cat '${otherFile}'. These files are inside your allowed workspace. Report both tool outputs. Do not combine the commands into one tool call. Do not use the network or delegate.`,
      })
      try {
        if (runtime === "codex") await verifyExplicitNativeLimit(first.sessionId)
        if (first.status === "failed") {
          await app.open(`/session/${first.sessionId}`)
          await expect(screen.getByText("Execution failed", { exact: true }).last()).toBeVisible()
          await expect(screen.getByRole("button", "Stop", { exact: true })).not.toBeVisible()
        }
        expect(first.status, first.error).toBe("completed")
        expect(first.output.length).toBeGreaterThan(0)
        const events = await api<{
          events: Array<{
            type: string
            data: {
              messageId?: string
              callId?: string
              args?: object
              result?: string
              success?: boolean
            }
          }>
        }>(browser, `/sessions/${first.sessionId}/events?limit=500`)
        const call = events.events.find(
          (event) =>
            event.type === "tool_call" &&
            JSON.stringify(event.data.args ?? {}).includes(file.split("/").at(-1)!),
        )
        const otherCall = events.events.find(
          (event) =>
            event.type === "tool_call" &&
            JSON.stringify(event.data.args ?? {}).includes(otherFile.split("/").at(-1)!) &&
            event.data.callId !== call?.data.callId,
        )
        expect(call?.data.callId).toBeDefined()
        expect(otherCall?.data.callId).toBeDefined()
        expect(otherCall!.data.callId).not.toBe(call!.data.callId)
        const firstArgs = JSON.stringify(call!.data.args)
        const otherArgs = JSON.stringify(otherCall!.data.args)
        expect(firstArgs).toContain(marker)
        expect(firstArgs).not.toContain(otherFile.split("/").at(-1)!)
        expect(otherArgs).toContain(otherMarker)
        expect(otherArgs).not.toContain(file.split("/").at(-1)!)
        for (const [callId, expected] of [
          [call!.data.callId, marker],
          [otherCall!.data.callId, otherMarker],
        ] as const) {
          const result = events.events.find(
            (event) =>
              event.type === "tool_result" &&
              event.data.messageId === first.messageId &&
              event.data.callId === callId,
          )
          expect(result?.data.success).toBe(true)
          expect(shellOutput(result!.data.result!)).toBe(expected)
        }
        const second = await api<{
          messageId: string
          status: string
          output: string
          error?: string
        }>(browser, "/sessions/run", "POST", {
          sessionId: first.sessionId,
          agentRuntime: runtime,
          ...(model ? { model } : {}),
          content: `Call your shell tool once with this exact command: cat '${file}' '${otherFile}'. Do not write files or insert separators. Reply with the tool output. Do not use the network.`,
        })
        const state = await api<{ reasoningEffort: string }>(
          browser,
          `/sessions/${first.sessionId}`,
        )
        expect(state.reasoningEffort).toBe("low")
        if (second.status === "failed") {
          await app.open(`/session/${first.sessionId}`)
          await expect(screen.getByText("Execution failed", { exact: true }).last()).toBeVisible()
          await expect(screen.getByRole("button", "Stop", { exact: true })).not.toBeVisible()
        }
        expect(second.status, second.error).toBe("completed")
        expect(second.output.length).toBeGreaterThan(0)
        await app.open(`/session/${first.sessionId}`)
        await browser.reload()
        await expect(screen.getByRole("button", "Stop", { exact: true })).not.toBeVisible()
        await expect(screen.getByText(title, { exact: true }).first()).toBeVisible()
        const messages = await api<{ messages: Array<{ content: string; status: string }> }>(
          browser,
          `/sessions/${first.sessionId}/messages`,
        )
        const persisted = await api<{
          events: Array<{
            type: string
            data: {
              messageId?: string
              callId?: string
              args?: object
              success?: boolean
              content?: string
              result?: string
            }
          }>
        }>(browser, `/sessions/${first.sessionId}/events?limit=500`)
        const readCall = persisted.events.find(
          (event) =>
            event.type === "tool_call" &&
            event.data.messageId === second.messageId &&
            JSON.stringify(event.data.args ?? {}).includes(file.split("/").at(-1)!) &&
            JSON.stringify(event.data.args ?? {}).includes(otherFile.split("/").at(-1)!),
        )
        expect(readCall?.data.callId).toBeDefined()
        // Codex command item IDs are scoped to their message and can repeat on follow-up.
        const readResult = persisted.events.find(
          (event) =>
            event.type === "tool_result" &&
            event.data.messageId === second.messageId &&
            event.data.callId === readCall!.data.callId,
        )
        expect(readResult?.data.success).toBe(true)
        expect(shellOutput(readResult!.data.result!)).toBe(marker + otherMarker)
        for (const [messageId, output] of [
          [first.messageId, first.output],
          [second.messageId, second.output],
        ]) {
          const text = persisted.events
            .filter((event) => event.type === "token" && event.data.messageId === messageId)
            .at(-1)?.data.content
          expect(text).toBe(output)
        }
        expect(
          messages.messages.filter((message) => message.status === "completed").length,
        ).toBeGreaterThanOrEqual(2)
      } finally {
        await api(browser, `/sessions/${first.sessionId}`, "DELETE")
      }
    },
  )
}
