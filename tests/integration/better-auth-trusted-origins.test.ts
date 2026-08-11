import {
  getStageMetadataFromConfigSync,
  getStageMetadataSync,
} from "../../packages/shared/src/stageMetadata"
import { describe, expect, it } from "vitest"
import {
  compiledStageEnv,
  TEST_APPLICATION_CONFIG,
  TEST_DEPLOYMENT_CONFIG,
} from "../fixtures/stage-metadata"

const PRE_STAGE_ENV = compiledStageEnv("pre")
const PROD_STAGE_ENV = compiledStageEnv("prod")

describe("stage auth metadata", () => {
  it("uses the local web app origin for auth URLs in dev", () => {
    const auth = getStageMetadataSync("dev").infra

    expect(auth.authBaseUrl).toBe("http://localhost:3000")
    expect(auth.authTrustedOrigins).toEqual(
      expect.arrayContaining([
        "http://localhost:1337",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ]),
    )
  })

  it("splits the pre web origin from the pre API origin", () => {
    const infra = getStageMetadataSync(PRE_STAGE_ENV).infra

    expect(infra.serverUrl).toBe("https://api.ai-pre.example.org")
    expect(infra.authBaseUrl).toBe("https://ai-pre.example.org")
    expect(infra.authTrustedOrigins).toEqual(["https://ai-pre.example.org"])
    expect(infra.apiDomains).toEqual(["api.ai-pre.example.org"])
    expect(infra.webDomains).toEqual(["ai-pre.example.org"])
  })

  it("splits the prod web origin from the prod API origin", () => {
    const infra = getStageMetadataSync(PROD_STAGE_ENV).infra

    expect(infra.serverUrl).toBe("https://api.ai.example.org")
    expect(infra.authBaseUrl).toBe("https://ai.example.org")
    expect(infra.authTrustedOrigins).toEqual(["https://ai.example.org"])
    expect(infra.apiDomains).toEqual(["api.ai.example.org"])
    expect(infra.webDomains).toEqual(["ai.example.org"])
  })

  it("requires deployment.zone for deployed stage metadata", () => {
    expect(() =>
      getStageMetadataFromConfigSync(
        "pre",
        { ...TEST_DEPLOYMENT_CONFIG, zone: "" },
        TEST_APPLICATION_CONFIG,
      ),
    ).toThrow("deployment.zone is required")
  })

  it("derives deployed infra from compiled s0 configuration", () => {
    const infra = getStageMetadataSync(
      compiledStageEnv("pre-42", {
        ...TEST_DEPLOYMENT_CONFIG,
        useApiShield: true,
        observability: {
          logsDestinations: ["logs-destination"],
          tracesDestinations: ["traces-destination"],
          logsHeadSamplingRate: 0.75,
          tracesHeadSamplingRate: 0.5,
        },
      }),
    ).infra

    expect(infra.zone).toBe("example.org")
    expect(infra.serverUrl).toBe("https://api.ai-pre-42.example.org")
    expect(infra.authBaseUrl).toBe("https://ai-pre-42.example.org")
    expect(infra.authTrustedOrigins).toEqual(["https://ai-pre-42.example.org"])
    expect(infra.apiDomains).toEqual(["api.ai-pre-42.example.org"])
    expect(infra.webDomains).toEqual(["ai-pre-42.example.org"])
    expect(infra.useApiShield).toBe(true)
    expect(infra.apiObservabilityLogsDestinations).toEqual(["logs-destination"])
    expect(infra.apiObservabilityTracesDestinations).toEqual(["traces-destination"])
    expect(infra.apiObservabilityLogsHeadSamplingRate).toBe(0.75)
    expect(infra.apiObservabilityTracesHeadSamplingRate).toBe(0.5)
  })

  it("uses exact FQDN overrides from SolZero configuration", () => {
    const infra = getStageMetadataSync(
      compiledStageEnv("prod", {
        ...TEST_DEPLOYMENT_CONFIG,
        webFqdn: "console.example.org",
        apiFqdn: "api.console.example.org",
      }),
    ).infra

    expect(infra.serverUrl).toBe("https://api.console.example.org")
    expect(infra.authBaseUrl).toBe("https://console.example.org")
    expect(infra.apiDomains).toEqual(["api.console.example.org"])
    expect(infra.webDomains).toEqual(["console.example.org"])
  })
})
