import { createFileRoute } from "@tanstack/react-router"

// The workflows route renders the list and the open workflow from the pathname, so this route only
// declares the URL.
export const Route = createFileRoute("/_authenticated/workflows/$workflowId")()
