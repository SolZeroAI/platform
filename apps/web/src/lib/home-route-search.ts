export const HOME_PREVIOUS_SESSIONS_HASH = "previous-sessions"
export const HOME_NEW_AGENT_HASH = "new-agent"

export function isHomePreviousSessionsHash(hash: string): boolean {
  return hash === HOME_PREVIOUS_SESSIONS_HASH
}

export function isHomeNewAgentHash(hash: string): boolean {
  return hash === HOME_NEW_AGENT_HASH
}
