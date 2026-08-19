import { Schema } from "effect"

export const BotStatus = Schema.Literals(["active", "paused"])
export const BotRoutineKind = Schema.Literals(["standing", "temporary"])
export const BotRoutineCadenceKind = Schema.Literals(["cron", "interval"])
export const BotRoutineWatchKind = Schema.Literals(["none", "github_pull_request"])
export const BotRoutineWatchCompleteWhen = Schema.Literals(["merged_or_closed", "checks_concluded"])

export class BotRoutineCadence extends Schema.Class<BotRoutineCadence>("BotRoutineCadence")({
  kind: BotRoutineCadenceKind,
  cron: Schema.optionalKey(Schema.String),
  intervalSeconds: Schema.optionalKey(Schema.Number),
}) {}

export class BotRoutineWatch extends Schema.Class<BotRoutineWatch>("BotRoutineWatch")({
  kind: BotRoutineWatchKind,
  owner: Schema.optionalKey(Schema.String),
  repo: Schema.optionalKey(Schema.String),
  pullNumber: Schema.optionalKey(Schema.Number),
  completeWhen: Schema.optionalKey(BotRoutineWatchCompleteWhen),
}) {}

export class BotItem extends Schema.Class<BotItem>("BotItem")({
  id: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  instructions: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  status: BotStatus,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class BotRoutineItem extends Schema.Class<BotRoutineItem>("BotRoutineItem")({
  id: Schema.String,
  botId: Schema.String,
  userId: Schema.String,
  name: Schema.String,
  kind: BotRoutineKind,
  cadence: BotRoutineCadence,
  prompt: Schema.String,
  until: Schema.NullOr(Schema.Number),
  watch: BotRoutineWatch,
  status: Schema.Literals(["active"]),
  lastRunAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class BotListResponse extends Schema.Class<BotListResponse>("BotListResponse")({
  bots: Schema.Array(BotItem),
}) {}

export class BotResponse extends Schema.Class<BotResponse>("BotResponse")({
  bot: BotItem,
}) {}

export class CreatedBotResponse extends Schema.Class<CreatedBotResponse>("CreatedBotResponse")({
  bot: BotItem,
}) {}

export class BotRoutineListResponse extends Schema.Class<BotRoutineListResponse>(
  "BotRoutineListResponse",
)({
  routines: Schema.Array(BotRoutineItem),
}) {}

export class BotRoutineResponse extends Schema.Class<BotRoutineResponse>("BotRoutineResponse")({
  routine: BotRoutineItem,
}) {}

export class DeletedBotRoutineResponse extends Schema.Class<DeletedBotRoutineResponse>(
  "DeletedBotRoutineResponse",
)({
  status: Schema.String,
  routineId: Schema.String,
}) {}

export class CreateBotPayload extends Schema.Class<CreateBotPayload>("CreateBotPayload")({
  name: Schema.String,
  instructions: Schema.optionalKey(Schema.String),
}) {}

export class CreateBotRoutinePayload extends Schema.Class<CreateBotRoutinePayload>(
  "CreateBotRoutinePayload",
)({
  name: Schema.String,
  kind: BotRoutineKind,
  cadence: BotRoutineCadence,
  prompt: Schema.String,
  until: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  watch: Schema.optionalKey(BotRoutineWatch),
}) {}

export class OpenBotPayload extends Schema.Class<OpenBotPayload>("OpenBotPayload")({
  sessionId: Schema.optionalKey(Schema.String),
}) {}

export class OpenBotResponse extends Schema.Class<OpenBotResponse>("OpenBotResponse")({
  bot: BotItem,
}) {}

export const BotIdParams = {
  id: Schema.String,
}
export type BotIdParams = { id: string }

export const BotRoutineParams = {
  id: Schema.String,
  routineId: Schema.String,
}
export type BotRoutineParams = { id: string; routineId: string }
