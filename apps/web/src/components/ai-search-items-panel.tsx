"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AdminAiSearchItemsResponse } from "@solzero/api"
import { Button } from "@cloudflare/kumo/components/button"
import { requestJson } from "@/lib/admin-console-actions"

function fileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result).split(",", 2)[1])
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

export function AiSearchItemsPanel({
  sourceId,
  onClose,
}: {
  sourceId: string
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const queryKey = ["admin", "ai-search-items", sourceId]
  const path = `/api/admin/ai-search/sources/${encodeURIComponent(sourceId)}/items`

  const documents = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => requestJson<AdminAiSearchItemsResponse>(`${path}?page=${page}`),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size === 0 || file.size > 10 * 1024 * 1024) {
        throw new Error("Choose a file between 1 byte and 10 MiB.")
      }

      const contentBase64 = await fileContent(file)

      await requestJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64,
        }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      requestJson(`${path}/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const busy = upload.isPending || remove.isPending
  const error = upload.error || remove.error || documents.error
  const data = documents.data

  return (
    <section
      aria-label={`Documents for ${sourceId}`}
      className="space-y-4 rounded-lg border border-kumo-hairline p-4"
    >
      <div className="flex items-center justify-between">
        <h2>Documents: {sourceId}</h2>
        <Button onClick={onClose}>Close documents</Button>
      </div>
      <p>
        Uploads are indexed asynchronously. Refresh to check processing status. A matching filename
        replaces that document. PDF and text files support up to 10 MiB; other formats support up to
        4 MiB.
      </p>
      <label>
        Upload document
        <input
          type="file"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]

            if (file) upload.mutate(file)

            event.target.value = ""
          }}
        />
      </label>
      <Button disabled={busy || documents.isFetching} onClick={() => void documents.refetch()}>
        Refresh documents
      </Button>
      {error && <p role="alert">{error.message}</p>}
      <ul>
        {data?.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <span>{item.key}</span>
            <span>{item.status}</span>
            <Button disabled={busy} onClick={() => remove.mutate(item.id)}>
              Delete {item.key}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>
          Previous documents
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={busy || !data || page * 50 >= data.total}
          onClick={() => setPage((value) => value + 1)}
        >
          Next documents
        </Button>
      </div>
    </section>
  )
}
