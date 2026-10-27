import { createFileRoute } from "@tanstack/react-router"
import { forwardPublicApiRequest } from "@/lib/control-plane"

// Cloudflare path routes send deployed /api traffic straight to the API Worker. This route only
// serves local and workers.dev ingress, through the same entrypoint and endpoint authentication.
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => forwardPublicApiRequest(request),
      HEAD: ({ request }) => forwardPublicApiRequest(request),
      POST: ({ request }) => forwardPublicApiRequest(request),
      PUT: ({ request }) => forwardPublicApiRequest(request),
      PATCH: ({ request }) => forwardPublicApiRequest(request),
      DELETE: ({ request }) => forwardPublicApiRequest(request),
      OPTIONS: ({ request }) => forwardPublicApiRequest(request),
    },
  },
})
