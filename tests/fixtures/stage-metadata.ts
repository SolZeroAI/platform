import {
  getStageMetadataFromConfigSync,
  type C0ApplicationConfig,
  type C0DeploymentConfig,
} from "../../packages/shared/src"

export const TEST_APPLICATION_CONFIG: C0ApplicationConfig = {
  logLevel: "debug",
  sendSlackNotifications: false,
  slackChannel: "",
  sandboxInactivityTimeoutMs: 600_000,
  showTestErrorButton: false,
  betterAuthSessionTransferEnabled: true,
}

export const TEST_DEPLOYMENT_CONFIG: C0DeploymentConfig = {
  appName: "c0-test",
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
  deployment: C0DeploymentConfig = TEST_DEPLOYMENT_CONFIG,
  application: C0ApplicationConfig = TEST_APPLICATION_CONFIG,
) {
  const metadata = getStageMetadataFromConfigSync(stage, deployment, application)
  return {
    STAGE: stage,
    C0_STAGE_METADATA: {
      _tag: metadata._tag,
      name: metadata.name,
      app: metadata.app,
      infra: metadata.infra,
    },
  }
}
