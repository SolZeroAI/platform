import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect } from "e2e"
import { requireFixture } from "./external-fixtures"

const executeProcess = promisify(execFile)
const execute = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer?: number },
) =>
  executeProcess(command, args, options).catch(() => {
    throw new Error("Isolated provider probe process failed")
  })

export async function verifyExplicitNativeLimit(sessionId: string) {
  const running = await execute(
    "docker",
    [
      "ps",
      "--filter",
      "name=workerd-s0-e2e.*-api-dev-CodexAgentContainer",
      "--format",
      "{{.ID}} {{.Names}}",
    ],
    { timeout: 10_000 },
  )
  const owned: string[] = []
  for (const row of running.stdout.trim().split("\n").filter(Boolean)) {
    if (row.endsWith("-proxy")) continue
    const id = row.split(" ")[0]!
    const selected = await execute(
      "docker",
      [
        "exec",
        id,
        "node",
        "-e",
        String.raw`
      let status = 0;
      fetch("http://127.0.0.1:8787/current-session", { signal: AbortSignal.timeout(5000) })
        .then(async response => { status = response.status; const value = await response.json(); return { belongs: value.sessionId === process.argv[1], status } })
        .catch(error => ({ belongs: false, status, errorKind: error.name, errorCode: error.cause?.code }))
        .then(value => process.stdout.write(JSON.stringify(value)))
    `,
        sessionId,
      ],
      { timeout: 10_000 },
    )
    const ownership = JSON.parse(selected.stdout) as {
      belongs: boolean
      status: number
      errorKind?: string
      errorCode?: string
    }
    console.info("container ownership check", ownership)
    if (ownership.belongs) owned.push(id)
  }
  expect(owned).toHaveLength(1)
  const account = requireFixture("CLOUDFLARE_ACCOUNT_ID")
  const probe = await execute(
    "docker",
    [
      "exec",
      "--env",
      "NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      owned[0]!,
      "node",
      "-e",
      String.raw`
    fetch("https://api.cloudflare.com/client/v4/accounts/" + process.argv[1] + "/ai/v1/responses", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ model: "@cf/openai/gpt-oss-120b", stream: true, max_output_tokens: 8,
        reasoning: { effort: "low" }, input: "List every integer from 1 through 200, one per line." })
    }).then(async response => {
      const text = await response.text();
      const events = text.split("\n").filter(line => line.startsWith("data: ")).map(line => {
        try { return JSON.parse(line.slice(6)) } catch { return {} }
      });
      const terminal = events.find(event => event.type === "response.incomplete");
      process.stdout.write(JSON.stringify({ status: response.status, terminal: terminal?.response?.status,
        reason: terminal?.response?.incomplete_details?.reason, outputTokens: terminal?.response?.usage?.output_tokens }));
    }).catch(error => { process.stdout.write(JSON.stringify({ status: 0, errorKind: error.name, errorCode: error.cause?.code })) })
  `,
      account,
    ],
    { timeout: 40_000, maxBuffer: 4096 },
  )
  const result = JSON.parse(probe.stdout) as {
    status: number
    terminal: string
    reason: string
    outputTokens: number
  }
  console.info("native explicit-limit probe", result)
  expect(result.status).toBe(200)
  expect(result.terminal).toBe("incomplete")
  expect(result.reason).toBe("max_output_tokens")
  expect(result.outputTokens).toBeGreaterThan(0)
  expect(result.outputTokens).toBeLessThanOrEqual(8)
}
