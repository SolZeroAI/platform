import { randomBytes } from "node:crypto"
import { readFileSync, statSync, writeFileSync, chmodSync } from "node:fs"
import { test, expect } from "e2e"
import dotenv from "dotenv"
import {
  resolveS0Config,
  s0ActiveSecretReferences,
  DEFAULT_PLANETSCALE_CONFIG,
} from "@solzero/shared"
import { OpenApi } from "effect/http-api"
import { apiForBrand } from "../packages/api/src/http"
import { getApiInfraEnv } from "../apps/api/infra"
import {
  createPullRequestSkillMarkdown,
  isCreatePullRequestSkillId,
} from "../packages/api/src/server/background/skills/built-ins"
import { exampleDeploymentConfig, withConfigFixture } from "./support/deployment-config"

test("PR helper branding keeps both persisted built-in skill identities usable", async () => {
  expect(isCreatePullRequestSkillId("skill_c0_create_pr")).toBe(true)
  expect(isCreatePullRequestSkillId("skill_s0_create_pr")).toBe(true)
  expect(isCreatePullRequestSkillId("user-owned-skill")).toBe(false)

  const markdown = createPullRequestSkillMarkdown({
    skillName: "c0-create-pr",
    brandName: "Example Fork",
    command: "example-create-pr",
  })

  expect(markdown).toContain("name: c0-create-pr")
  expect(markdown).toContain('example-create-pr "PR title" "PR body"')
  expect(markdown).toContain("Example Fork-managed branch")
})

test("a complete stage brand overrides environment branding and normalizes its values", async () => {
  const source = exampleDeploymentConfig()

  const configured = resolveS0Config(
    { ...source, brand: { ...source.brand, name: "  Example Fork  " } },
    { VITE_S0_BRAND_NAME: "Unselected environment brand" },
  )

  expect(configured.brand.name).toBe("Example Fork")
  expect(configured.brand.logoLightPath).toBe(source.brand.logoLightPath)
})

test("existing brand environment overrides work when the stage file omits brand", async () => {
  const { brand: _brand, ...legacy } = exampleDeploymentConfig()

  const configured = resolveS0Config(legacy, {
    VITE_S0_BRAND_NAME: "Environment Fork",
    VITE_S0_BRAND_LOGO_PATH: "/brands/shared.svg",
  })

  expect(configured.brand.name).toBe("Environment Fork")
  expect(configured.brand.logoLightPath).toBe("/brands/shared.svg")
  expect(configured.brand.logoDarkPath).toBe("/brands/shared.svg")
  expect(resolveS0Config(legacy).brand.name).toBe("SolZero")
})

test("resolved configuration compiles into narrow server identity inputs", async () => {
  const source = exampleDeploymentConfig()

  const configured = resolveS0Config({
    ...source,
    brand: { ...source.brand, name: "Example Fork" },
    deployment: { ...source.deployment, appName: "example-fork" },
    integrations: {
      ...source.integrations,
      githubApp: {
        ...source.integrations.githubApp,
        createPullRequestCommand: "example-create-pr",
      },
    },
  })

  const secrets = Object.fromEntries(
    s0ActiveSecretReferences(configured).map((reference) => [
      reference.env,
      randomBytes(48).toString("base64url"),
    ]),
  )

  const inputs = getApiInfraEnv(configured, "config/fixture-pre.config.jsonc", "digest", secrets)
  expect(inputs.S0_BRAND_NAME).toBe("Example Fork")
  expect(inputs.S0_SERVICE_NAME).toBe("example-fork-agent-control-plane")
  expect(inputs.S0_CREATE_PR_COMMAND).toBe("example-create-pr")
  expect(Object.hasOwn(inputs, "S0_CONFIG")).toBe(false)
})

test("profile validation and stage URLs select the same complete named file", async () => {
  const source = exampleDeploymentConfig()
  withConfigFixture(
    {
      ...source,
      deployment: {
        ...source.deployment,
        zone: "example.test",
        webFqdn: "agent.example.test",
        apiFqdn: "api.agent.example.test",
      },
    },
    (fixture) => {
      const checked = fixture.run(["check"])
      expect(checked.status).toBe(0)
      expect(checked.stdout).toContain("config/fixture-pre.config.jsonc")
      expect(checked.stdout).toContain("config/fixture-test.config.jsonc")
      const url = fixture.run(["stage-url", "pre"])
      expect(url.status).toBe(0)
      expect(url.stdout.trim()).toBe("https://agent.example.test")
      const missing = fixture.run(["check", "--profile", "missing"])
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain("missing-dev.config.jsonc")
    },
  )
})

test("the stage secret writer includes only active references without printing their values", async () => {
  const source = exampleDeploymentConfig()

  const configured = {
    ...source,
    security: { ...source.security, tokenEncryptionKey: { env: "FORK_TOKEN_KEY" } },
  }

  withConfigFixture(configured, (fixture) => {
    const value = randomBytes(48).toString("base64url")

    writeFileSync(fixture.varsPath, "UNREFERENCED_TOKEN=\n")
    chmodSync(fixture.varsPath, 0o644)
    const written = fixture.run(["write-stage-vars", "pre", fixture.varsPath], {
      FORK_TOKEN_KEY: value,
      UNREFERENCED_TOKEN: randomBytes(48).toString("base64url"),
    })

    expect(written.status).toBe(0)
    const values = dotenv.parse(readFileSync(fixture.varsPath))
    expect(values.FORK_TOKEN_KEY === value).toBe(true)
    expect(Object.hasOwn(values, "UNREFERENCED_TOKEN")).toBe(false)
    expect(written.stdout.includes(value) || written.stderr.includes(value)).toBe(false)
    expect(statSync(fixture.varsPath).mode & 0o777).toBe(0o600)
  })
})

test("the CLI rejects incomplete branding and unsafe executable names before deployment", async () => {
  const source = exampleDeploymentConfig()
  withConfigFixture(source, (fixture) => {
    fixture.writePre(JSON.stringify({ ...source, brand: { name: "Incomplete" } }))
    const incomplete = fixture.run(["stage-url", "pre"])
    expect(incomplete.status).toBe(1)
    expect(incomplete.stderr).toContain("brand")
    fixture.writePre(
      JSON.stringify({
        ...source,
        integrations: {
          ...source.integrations,
          githubApp: { ...source.integrations.githubApp, createPullRequestCommand: "../../helper" },
        },
      }),
    )
    const unsafe = fixture.run(["stage-url", "pre"])
    expect(unsafe.status).toBe(1)
    expect(unsafe.stderr).toContain("createPullRequestCommand")
  })
})

test("PlanetScale provisioning is optional, configurable, and rejects invalid capacity inputs", async () => {
  const source = exampleDeploymentConfig()
  expect(DEFAULT_PLANETSCALE_CONFIG).toEqual({ clusterSize: "PS_10", logicalDatabaseName: "s0" })

  const planetscale = {
    clusterSize: "PS_20",
    logicalDatabaseName: "example_fork",
    region: "aws-us-east-1",
    arch: "arm" as const,
    replicas: 2,
    majorVersion: "17",
  }

  expect(
    resolveS0Config({ ...source, deployment: { ...source.deployment, planetscale } }).deployment
      .planetscale,
  ).toEqual(planetscale)
  withConfigFixture(source, (fixture) => {
    fixture.writePre(
      JSON.stringify({
        ...source,
        deployment: { ...source.deployment, planetscale: { ...planetscale, replicas: 1 } },
      }),
    )
    const rejected = fixture.run(["stage-url", "pre"])
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain("replicas")
  })
})

test("OpenAPI identity uses the configured runtime brand", async () => {
  const document = OpenApi.fromApi(apiForBrand("Example Fork"))
  expect(document.info.title).toBe("Example Fork Agent API")
  expect(document.info.description).toBe("API for Example Fork Agent")
})

test("preview and validation workflows target master only", async () => {
  for (const workflow of ["preview", "validate"]) {
    const source = readFileSync(`.github/workflows/${workflow}.yml`, "utf8")
    expect(source).toContain("branches:\n      - master")
    expect(source).not.toContain("\n      - main")
  }
})
