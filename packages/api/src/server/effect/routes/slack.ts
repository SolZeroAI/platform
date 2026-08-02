import { HttpApiBuilder } from "effect/unstable/httpapi"
import { C0Api } from "@c0/api"
import { createSession, prompt, queuePrompt, run, stop } from "../handlers/slack"
import { observeRoute } from "../services/observability"

export const HttpSlackLive = HttpApiBuilder.group(C0Api, "slack", (handlers) =>
  handlers
    .handle("createSession", (input) =>
      observeRoute("slack", "createSession", createSession(input)),
    )
    .handle("queuePrompt", (input) => observeRoute("slack", "queuePrompt", queuePrompt(input)))
    .handle("run", (input) => observeRoute("slack", "run", run(input)))
    .handle("prompt", (input) => observeRoute("slack", "prompt", prompt(input)))
    .handle("stop", (input) => observeRoute("slack", "stop", stop(input))),
)
