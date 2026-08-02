---
name: feature-stage-metadata-environment-values
description: When adding stage-specific values or conditionals, put them on stageMetadata instead of comparing STAGE directly
---
# Stage Metadata Instead Of Stage Checks

Use `packages/shared/src/stageMetadata.ts` as the single place for non-secret stage-specific behavior across apps, packages, and infra.

- When code needs a different value or branch by environment, add a property to `StageProps`, `InfraStageProps`, or `AppStageProps` and read it from `stageMetadata`.
- Do not add ad hoc checks like `env.STAGE === "dev"`, `stage === "prod"`, or `startsWith("pre-")` outside `stageMetadata.ts`.
- Keep stage parsing and environment branching centralized in `stageMetadata.ts`.
- Secrets still belong in env vars, not in `stageMetadata`.

## Pattern

```typescript
// Bad
const trustedOrigins =
  env.STAGE === "dev" ? ["http://localhost:3000"] : [baseURL]

// Good
const stageMetadata = getStageMetadataSync(env.STAGE)
const trustedOrigins = stageMetadata.infra.authTrustedOrigins
```

- Public origins, hostnames, URLs, and ports
- Feature flags and capability toggles that vary by stage
- Stage-specific limits, defaults, and allowlists
- Integration endpoints and non-secret provider config
- Prefer property names that describe the business meaning, not the stage check they replaced.
