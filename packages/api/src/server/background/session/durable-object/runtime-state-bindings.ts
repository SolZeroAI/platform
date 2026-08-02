import { type IsolateWarmResult } from "../../isolate/runtime"
import type { IsolateStreamState } from "../durable-object"
import { type ParticipantRow, type SessionRow } from "../types"
import {
  buildIsolateConfigFor,
  buildIsolateSessionConfig,
  closeIsolateStream,
  closeStream,
  decryptSecretEnv,
  ensureIsolateReady,
  failIsolateStream,
  getAgentRuntime,
  finalizeWarmFailure,
  finalizeWarmSuccess,
  getIsolateCloneAuth,
  getIsolateCloneAuthEffect,
  getSandboxCloneCredentials,
  getSandboxCloneCredentialsEffect,
  getSessionId,
  getSessionKind,
  getSessionOwner,
  getSessionState,
  isIsolateRuntimeReady,
  maybeBroadcastSandboxError,
  reconcileSandboxStatusIfSandbox,
  registerIsolateStream,
  repoBackedSessionOwner,
  resolveCloneCredentialsEffect,
  resolveSecretEnv,
  syncIsolateRuntime,
  syncIsolateRuntimeEffect,
  warmIsolateRuntime,
} from "./runtime-state"

export function installSessionDORuntimeStateBindings(SessionDO: {
  prototype: Record<string, unknown>
}) {
  Object.assign(SessionDO.prototype, {
    getSessionState() {
      return getSessionState(this)
    },
    reconcileSandboxStatusIfSandbox(session: SessionRow | null) {
      return reconcileSandboxStatusIfSandbox(this, session)
    },
    getSessionId() {
      return getSessionId(this)
    },
    getSessionKind() {
      return getSessionKind(this)
    },
    getAgentRuntime() {
      return getAgentRuntime(this)
    },
    getSessionOwner() {
      return getSessionOwner(this)
    },
    buildIsolateSessionConfig() {
      return buildIsolateSessionConfig(this)
    },
    buildIsolateConfigFor(session: SessionRow, owner: ParticipantRow) {
      return buildIsolateConfigFor(this, session, owner)
    },
    resolveSecretEnv(userId: string, secretKeysJson: string | null | undefined) {
      return resolveSecretEnv(this, userId, secretKeysJson)
    },
    decryptSecretEnv(userId: string, secretKeys: string[]) {
      return decryptSecretEnv(this, userId, secretKeys)
    },
    getIsolateCloneAuth() {
      return getIsolateCloneAuth(this)
    },
    getIsolateCloneAuthEffect() {
      return getIsolateCloneAuthEffect(this)
    },
    getSandboxCloneCredentials() {
      return getSandboxCloneCredentials(this)
    },
    getSandboxCloneCredentialsEffect() {
      return getSandboxCloneCredentialsEffect(this)
    },
    repoBackedSessionOwner() {
      return repoBackedSessionOwner(this)
    },
    resolveCloneCredentialsEffect(session: SessionRow, owner: ParticipantRow) {
      return resolveCloneCredentialsEffect(this, session, owner)
    },
    syncIsolateRuntime() {
      return syncIsolateRuntime(this)
    },
    syncIsolateRuntimeEffect() {
      return syncIsolateRuntimeEffect(this)
    },
    finalizeWarmFailure(result: IsolateWarmResult, now: number) {
      return finalizeWarmFailure(this, result, now)
    },
    maybeBroadcastSandboxError(lastError: string | null | undefined) {
      return maybeBroadcastSandboxError(this, lastError)
    },
    finalizeWarmSuccess(result: IsolateWarmResult, now: number) {
      return finalizeWarmSuccess(this, result, now)
    },
    isIsolateRuntimeReady() {
      return isIsolateRuntimeReady(this)
    },
    ensureIsolateReady() {
      return ensureIsolateReady(this)
    },
    warmIsolateRuntime() {
      return warmIsolateRuntime(this)
    },
    registerIsolateStream(messageId: string) {
      return registerIsolateStream(this, messageId)
    },
    closeIsolateStream(messageId: string) {
      return closeIsolateStream(this, messageId)
    },
    closeStream(messageId: string, stream: IsolateStreamState) {
      return closeStream(this, messageId, stream)
    },
    failIsolateStream(messageId: string, errorMessage: string) {
      return failIsolateStream(this, messageId, errorMessage)
    },
  })
}
