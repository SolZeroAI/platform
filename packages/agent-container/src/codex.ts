import { startServer } from "./server"

// Keep startup inside an IIFE so Alchemy's pure-call pass preserves the entrypoint side effect.
;(() => startServer("codex"))()
