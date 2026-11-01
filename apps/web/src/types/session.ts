// Session-related type definitions

import type { SessionArtifactMetadata } from "@solzero/shared"

export interface ArtifactPreviewMetadata extends SessionArtifactMetadata {
  prState?: "open" | "merged" | "closed" | "draft"
  filename?: string
  previewStatus?: "active" | "outdated" | "stopped"
}

export interface Artifact {
  id: string
  type: string
  url: string | null
  metadata?: ArtifactPreviewMetadata | null
  prNumber?: number
  createdAt: number
}
