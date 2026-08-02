// Session-related type definitions

export interface Artifact {
  id: string
  type: string
  url: string | null
  metadata?:
    | (Record<string, unknown> & {
        prNumber?: number
        prState?: "open" | "merged" | "closed" | "draft"
        filename?: string
        previewStatus?: "active" | "outdated" | "stopped"
      })
    | null
  prNumber?: number
  createdAt: number
}

export interface Task {
  content: string
  status: "pending" | "in_progress" | "completed"
  activeForm?: string
}

export interface FileChange {
  filename: string
  additions: number
  deletions: number
}

export interface ChildSession {
  id: string
  description: string
  prNumber?: number
  prState?: "open" | "merged" | "closed" | "draft"
  platform?: string
}

export interface SessionMetadata {
  title: string
  model?: string
  branchName?: string
  projectTag?: string
  createdAt: number
  updatedAt?: number
}
