export interface BotRecord {
  id: string
  userId: string
  name: string
  instructions: string
  sessionId: string | null
  status: "active" | "paused"
  createdAt: number
  updatedAt: number
}

export interface BotRoutineCadence {
  kind: "cron" | "interval"
  cron?: string
  intervalSeconds?: number
}

export interface BotRoutineWatch {
  kind: "none" | "github_pull_request"
  owner?: string
  repo?: string
  pullNumber?: number
  completeWhen?: "merged_or_closed" | "checks_concluded"
}

export interface BotRoutineRecord {
  id: string
  botId: string
  userId: string
  name: string
  kind: "standing" | "temporary"
  cadence: BotRoutineCadence
  prompt: string
  until: number | null
  watch: BotRoutineWatch
  status: "active"
  lastRunAt: number | null
  createdAt: number
  updatedAt: number
}
