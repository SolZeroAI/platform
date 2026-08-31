/* oxlint-disable effect/avoid-process-env -- Operator CLI entry reads argv through Effect CLI and Node services. */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import { Command } from "effect/unstable/cli"
import { copyD1ToPlanetscaleCommand } from "../packages/api/src/cli/copy-d1-to-planetscale-command"

if (process.argv[2] === "--") {
  process.argv.splice(2, 1)
}

copyD1ToPlanetscaleCommand.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
)
