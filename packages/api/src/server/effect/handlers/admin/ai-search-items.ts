import type { AdminAiSearchUploadPayload, AdminIdParams } from "@solzero/api"
import * as Effect from "effect/Effect"
import { AiSearchRegistryStore } from "../../../background/db/ai-search"
import { toError } from "../../../lib/effect-errors"
import {
  describeError,
  failMessage,
  failWhen,
  json,
  runControlPlane,
} from "../shared/control-plane"
import { requireAdmin, withAudit } from "./route-helpers"

const itemsResponse = Effect.fn("admin.aiSearch.itemsResponse")(function* (
  registry: AiSearchRegistryStore,
  sourceId: string,
  page = 1,
) {
  const response = yield* registry
    .listItems(sourceId, page)
    .pipe(Effect.catch((cause) => failMessage(describeError(cause), 400)))

  return json({
    items: response.result.map((item) => ({ id: item.id, key: item.key, status: item.status })),
    page,
    total: response.result_info?.total_count ?? response.result.length,
  })
})

export function aiSearchItems({
  params,
  query,
}: {
  params: AdminIdParams
  query: { page?: string }
}) {
  return runControlPlane(
    Effect.fn("admin.aiSearch.items")(function* (context) {
      yield* requireAdmin(context)

      return yield* itemsResponse(
        new AiSearchRegistryStore(context.env),
        params.id,
        Number(query.page ?? 1),
      )
    }),
  )
}

export function uploadAiSearchItem({
  params,
  payload,
}: {
  params: AdminIdParams
  payload: AdminAiSearchUploadPayload
}) {
  return runControlPlane(
    Effect.fn("admin.aiSearch.uploadItem")(function* (context) {
      const admin = yield* requireAdmin(context)

      yield* failWhen(payload.contentBase64.length > 14 * 1024 * 1024, "Upload exceeds 10 MiB", 400)

      const bytes = yield* Effect.try({
        try: () => Uint8Array.from(atob(payload.contentBase64), (c) => c.charCodeAt(0)),
        catch: toError,
      }).pipe(Effect.catch(() => failMessage("Invalid base64 content", 400)))

      const registry = new AiSearchRegistryStore(context.env)

      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search_source",
          targetId: params.id,
          action: "upload_item",
        },
        registry
          .uploadItem(params.id, payload.name, new Blob([bytes], { type: payload.contentType }))
          .pipe(
            Effect.catch((cause) => failMessage(describeError(cause), 400)),
            Effect.andThen(() => itemsResponse(registry, params.id)),
          ),
      )
    }),
  )
}

export function deleteAiSearchItem({ params }: { params: { id: string; itemId: string } }) {
  return runControlPlane(
    Effect.fn("admin.aiSearch.deleteItem")(function* (context) {
      const admin = yield* requireAdmin(context)

      const registry = new AiSearchRegistryStore(context.env)

      return yield* withAudit(
        {
          context,
          admin,
          targetType: "ai_search_source",
          targetId: params.id,
          action: "delete_item",
        },
        registry.deleteItem(params.id, params.itemId).pipe(
          Effect.catch((cause) => failMessage(describeError(cause), 400)),
          Effect.andThen(() => itemsResponse(registry, params.id)),
        ),
      )
    }),
  )
}
