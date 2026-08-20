import * as Match from "effect/Match"
import * as Schema from "effect/Schema"

// Typed failures for the background DB layer. Wrapping drizzle/D1 awaits in tagged errors keeps
// the Effect error channels explicit and composes with `catchTag`/`catchTags` at call sites.

export const D1FailureCauseSchema = Schema.Struct({
  message: Schema.String,
  name: Schema.optional(Schema.String),
})

export type D1FailureCause = typeof D1FailureCauseSchema.Type

function nestedFailureMessage(cause: unknown): string {
  return Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) =>
      [error.message, nestedFailureMessage(error.cause)]
        .filter((part) => part.length > 0)
        .join("\n"),
    ),
    Match.when(Match.string, (message) => message),
    Match.orElse(() => ""),
  )
}

export function d1FailureCause(cause: unknown): D1FailureCause {
  return Match.value(cause).pipe(
    Match.when(Match.instanceOf(Error), (error) => ({
      message: [error.message, nestedFailureMessage(error.cause)]
        .filter((part) => part.length > 0)
        .join("\n"),
      name: error.name,
    })),
    Match.orElse(() => ({ message: String(cause) })),
  )
}

/** Failure raised when a drizzle/D1 operation rejects. `cause` is the parsed rejection. */
export class D1Error extends Schema.TaggedError<D1Error>()("D1Error", {
  operation: Schema.String,
  cause: D1FailureCauseSchema,
}) {}

/** Builds a `catch` handler that tags a rejected drizzle/D1 promise with its `operation`. */
export function d1Error(operation: string) {
  return (cause: unknown): D1Error => new D1Error({ operation, cause: d1FailureCause(cause) })
}

/** Failure raised when a requested MCP Context Forge server is not available in the registry. */
export class McpcfServerUnavailableError extends Schema.TaggedError<McpcfServerUnavailableError>()(
  "McpcfServerUnavailableError",
  {
    serverIds: Schema.Array(Schema.String),
  },
) {}

/** Failure raised when MCP Context Forge configuration is incomplete (e.g. missing base URL). */
export class McpcfConfigurationError extends Schema.TaggedError<McpcfConfigurationError>()(
  "McpcfConfigurationError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when the user MCP settings table migration has not been applied. */
export class UserMcpcfMigrationError extends Schema.TaggedError<UserMcpcfMigrationError>()(
  "UserMcpcfMigrationError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when OpenCode permission preference storage is not migrated. */
export class UserProviderPreferenceMigrationError extends Schema.TaggedError<UserProviderPreferenceMigrationError>()(
  "UserProviderPreferenceMigrationError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when an Agent Skill package is malformed or unsafe. */
export class AgentSkillValidationError extends Schema.TaggedError<AgentSkillValidationError>()(
  "AgentSkillValidationError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when an active Agent Skill already owns the requested slug. */
export class AgentSkillConflictError extends Schema.TaggedError<AgentSkillConflictError>()(
  "AgentSkillConflictError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when an Agent Skill id does not resolve to an active catalog row. */
export class AgentSkillNotFoundError extends Schema.TaggedError<AgentSkillNotFoundError>()(
  "AgentSkillNotFoundError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when a bot id does not resolve to an owned row. */
export class BotNotFoundError extends Schema.TaggedError<BotNotFoundError>()("BotNotFoundError", {
  message: Schema.String,
}) {}

/** Failure raised when a bot routine id does not resolve to an owned row. */
export class BotRoutineNotFoundError extends Schema.TaggedError<BotRoutineNotFoundError>()(
  "BotRoutineNotFoundError",
  {
    message: Schema.String,
  },
) {}

/** Failure raised when a Workflow Slack delivery dedupe row cannot be located after an upsert. */
export class WorkflowSlackDeliveryError extends Schema.TaggedError<WorkflowSlackDeliveryError>()(
  "WorkflowSlackDeliveryError",
  {
    message: Schema.String,
  },
) {}
