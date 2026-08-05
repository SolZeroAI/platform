import {
  getStageMetadataFromConfigSync,
  type S0ApplicationConfig,
  type S0DeploymentConfig,
} from "../../packages/shared/src"

export const TEST_APPLICATION_CONFIG: S0ApplicationConfig = {
  logLevel: "debug",
  sendSlackNotifications: false,
  slackChannel: "",
  sandboxInactivityTimeoutMs: 600_000,
  showTestErrorButton: false,
  betterAuthSessionTransferEnabled: true,
}

export const TEST_DEPLOYMENT_CONFIG: S0DeploymentConfig = {
  appName: "s0-test",
  zone: "example.org",
  useApiShield: false,
  observability: {
    logsDestinations: [],
    tracesDestinations: [],
    logsHeadSamplingRate: 1,
    tracesHeadSamplingRate: 1,
  },
}

export function compiledStageEnv(
  stage: string,
  deployment: S0DeploymentConfig = TEST_DEPLOYMENT_CONFIG,
  application: S0ApplicationConfig = TEST_APPLICATION_CONFIG,
) {
  const metadata = getStageMetadataFromConfigSync(stage, deployment, application)
  return {
    STAGE: stage,
    S0_STAGE_METADATA: {
      _tag: metadata._tag,
      name: metadata.name,
      app: metadata.app,
      infra: metadata.infra,
    },
  }
}
