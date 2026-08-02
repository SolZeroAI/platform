import { parseSlackRegistrationStringArray } from "../slack-apps"
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import type {
  MatchRegistrationInput,
  NormalizedSlackPayload,
  SlackRegistration,
} from "./normalization"

export interface RegistrationMatchDetails {
  registration: SlackRegistration
  surfaceOk: boolean
  surfaceSpecificOk: boolean
  eventOk: boolean
  keywordsOk: boolean
  keywordRuleCount: number
  routeCommandId: string | null
  commandNodeOk: boolean
  commandNameOk: boolean
  actionIdsOk: boolean
  actionIdCount: number
  channelOk: boolean
  matched: boolean
}

export function computeRegistrationMatchDetails(
  input: MatchRegistrationInput,
): RegistrationMatchDetails {
  const eventTypes = parseSlackRegistrationStringArray(input.registration.event_types_json)
  const keywordRules = parseSlackRegistrationStringArray(input.registration.keyword_rules_json)
  const actionIds = parseSlackRegistrationStringArray(input.registration.action_ids_json)
  const surfaceOk = input.registration.surface === input.payload.surface
  const surfaceSpecificOk = surfaceRegistrationMatches(input)
  const channelOk = matchesChannelPattern(input.payload, input.registration.channel_name_pattern)
  return {
    registration: input.registration,
    surfaceOk,
    surfaceSpecificOk,
    eventOk: eventTypeMatches(eventTypes, input.payload),
    keywordsOk: keywordRulesMatch(keywordRules, input.payload),
    keywordRuleCount: keywordRules.length,
    routeCommandId: input.commandId ?? null,
    commandNodeOk: commandNodeMatches(input),
    commandNameOk: commandNameMatches(input),
    actionIdsOk: actionIdsMatch(actionIds, input.payload),
    actionIdCount: actionIds.length,
    channelOk,
    matched: matchesRegistration(input),
  }
}

export function registrationFilteredLogFields(
  details: RegistrationMatchDetails,
  payload: NormalizedSlackPayload,
): Record<string, unknown> {
  return {
    nodeId: details.registration.node_id,
    surfaceRegistration: details.registration.surface,
    surfacePayload: payload.surface,
    surfaceOk: details.surfaceOk,
    surfaceSpecificOk: details.surfaceSpecificOk,
    eventTypes: parseSlackRegistrationStringArray(details.registration.event_types_json),
    eventTypePayload: payload.eventType,
    eventOk: details.eventOk,
    channelPattern: details.registration.channel_name_pattern,
    channelName: payload.channelName,
    channelOk: details.channelOk,
    keywordRuleCount: details.keywordRuleCount,
    keywordsOk: details.keywordsOk,
    routeCommandId: details.routeCommandId,
    commandNodeOk: details.commandNodeOk,
    expectedCommand: details.registration.command_name,
    commandPayload: payload.command,
    commandNameOk: details.commandNameOk,
    actionIdCount: details.actionIdCount,
    actionIdPayload: payload.actionId,
    actionIdsOk: details.actionIdsOk,
  }
}

function testChannelPattern(channelName: string, pattern: string): boolean {
  return Result.match(
    Result.try({
      try: () => new RegExp(pattern, "i").test(channelName),
      catch: () => false as const,
    }),
    {
      onFailure: () => channelName.toLowerCase().includes(pattern.toLowerCase()),
      onSuccess: (matched) => matched,
    },
  )
}

function matchesChannelPattern(payload: NormalizedSlackPayload, pattern: string | null): boolean {
  return Option.match(Option.fromNullishOr(pattern), {
    onNone: () => true,
    onSome: (resolvedPattern) =>
      Option.match(Option.fromNullishOr(payload.channelName), {
        onNone: () => false,
        onSome: (channelName) => testChannelPattern(channelName, resolvedPattern),
      }),
  })
}

function matchMessageSubtype(eventType: string, channelType: string | null): boolean {
  return Match.value(eventType).pipe(
    Match.when("message", () => true),
    Match.when("message.channels", () => channelType === null || channelType === "channel"),
    Match.when("message.groups", () => channelType === null || channelType === "group"),
    Match.when("message.im", () => channelType === null || channelType === "im"),
    Match.when("message.mpim", () => channelType === null || channelType === "mpim"),
    Match.orElse(() => false),
  )
}

function messageEventTypeMatches(eventType: string, payload: NormalizedSlackPayload): boolean {
  return Match.value(payload.eventType !== "message").pipe(
    Match.when(true, () => false),
    Match.orElse(() => matchMessageSubtype(eventType, payload.channelType)),
  )
}

function eventTypeMatches(eventTypes: string[], payload: NormalizedSlackPayload): boolean {
  return Match.value(eventTypes.length === 0).pipe(
    Match.when(true, () => true),
    Match.orElse(() =>
      Option.match(Option.fromNullishOr(payload.eventType), {
        onNone: () => false,
        onSome: () =>
          Arr.some(
            eventTypes,
            (eventType) =>
              eventType === payload.eventType || messageEventTypeMatches(eventType, payload),
          ),
      }),
    ),
  )
}

function keywordRulesMatch(keywordRules: string[], payload: NormalizedSlackPayload): boolean {
  return (
    keywordRules.length === 0 ||
    Arr.some(keywordRules, (keyword) => payload.text.toLowerCase().includes(keyword.toLowerCase()))
  )
}

function eventRegistrationMatches(input: MatchRegistrationInput): boolean {
  const eventTypes = parseSlackRegistrationStringArray(input.registration.event_types_json)
  const keywordRules = parseSlackRegistrationStringArray(input.registration.keyword_rules_json)
  return (
    eventTypeMatches(eventTypes, input.payload) && keywordRulesMatch(keywordRules, input.payload)
  )
}

function commandNodeMatches(input: MatchRegistrationInput): boolean {
  return !input.commandId || input.commandId === input.registration.node_id
}

function commandNameMatches(input: MatchRegistrationInput): boolean {
  const expectedCommand = input.registration.command_name
  return (
    !expectedCommand ||
    (Boolean(input.payload.command) && expectedCommand === input.payload.command)
  )
}

function commandRegistrationMatches(input: MatchRegistrationInput): boolean {
  return commandNodeMatches(input) && commandNameMatches(input)
}

function actionIdsMatch(actionIds: string[], payload: NormalizedSlackPayload): boolean {
  return (
    actionIds.length === 0 ||
    (Boolean(payload.actionId) && actionIds.includes(payload.actionId ?? ""))
  )
}

function interactionRegistrationMatches(input: MatchRegistrationInput): boolean {
  const actionIds = parseSlackRegistrationStringArray(input.registration.action_ids_json)
  return actionIdsMatch(actionIds, input.payload)
}

function surfaceRegistrationMatches(input: MatchRegistrationInput): boolean {
  return Match.value(input.payload.surface).pipe(
    Match.when("event", () => eventRegistrationMatches(input)),
    Match.when("command", () => commandRegistrationMatches(input)),
    Match.when("interaction", () => interactionRegistrationMatches(input)),
    Match.orElse(() => true),
  )
}

export function matchesRegistration(input: MatchRegistrationInput): boolean {
  return Match.value(input.registration.surface === input.payload.surface).pipe(
    Match.when(false, () => false),
    Match.orElse(
      () =>
        surfaceRegistrationMatches(input) &&
        matchesChannelPattern(input.payload, input.registration.channel_name_pattern),
    ),
  )
}

export function eventPayloadRequiresSlackUser(payload: NormalizedSlackPayload): boolean {
  const channelType = payload.channelType
  const isDirectMessage = channelType === "im" || channelType === "mpim"
  return Match.value(payload.eventType).pipe(
    Match.when("app_mention", () => isDirectMessage),
    Match.when("message", () => isDirectMessage),
    Match.orElse(() => false),
  )
}

export function payloadRequiresSlackUser(payload: NormalizedSlackPayload): boolean {
  return Match.value(payload.surface).pipe(
    Match.when("command", () => true),
    Match.when("interaction", () => true),
    Match.when("event", () => eventPayloadRequiresSlackUser(payload)),
    Match.orElse(() => false),
  )
}
