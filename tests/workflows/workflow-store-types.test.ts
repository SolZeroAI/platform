import { describe, expectTypeOf, it } from "vitest"
import { WorkflowStore } from "../../packages/api/src/server/background/db/workflows"
import type { D1DrizzleDatabase } from "../../packages/api/src/server/effect/db/d1-drizzle"

describe("WorkflowStore types", () => {
  it("requires a Drizzle D1 database", () => {
    expectTypeOf<
      ConstructorParameters<typeof WorkflowStore>[0]
    >().toEqualTypeOf<D1DrizzleDatabase>()
    expectTypeOf<ConstructorParameters<typeof WorkflowStore>[0]>().not.toEqualTypeOf<D1Database>()
  })
})
