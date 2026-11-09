# AI Search documents

New AI Search sources use Cloudflare built-in storage. Administrators create a source in
Settings → Admin → AI Search, open **Documents**, and upload files. No external-storage
service token is required. The namespace binding creates instances; uploads use its Items API.

Uploads queue asynchronous indexing. Use **Refresh documents** to inspect item status. An upload
with the same filename replaces that item and indexes its new content. Choose distinct names
when retaining multiple versions. Names must contain 1–128 characters. The application accepts
1 byte–10 MiB; Cloudflare additionally enforces supported formats and its format-specific limits
(4 MiB for formats other than PDF and text). Upload acceptance does not prove successful indexing.

Only administrators can upload or delete global source documents. Source selection and MCP
search/ask tools continue to use the source registry. Deleting an item removes its indexed content;
deleting a source removes its Cloudflare instance and registry record.

## Workflow ingestion

Use **Upload to AI Search** to send text or JSON to a built-in source. Configure its source ID
and document name, then connect the `content` input. Connected `sourceId` and `name` inputs override
the configured values. JSON content is serialized as text. The outputs are `itemId`, `key`, and
`status`. The node completes when the upload is accepted, before indexing completes.

Global source ingestion requires an administrator workflow owner. A webhook-triggered run uses
the workflow owner's identity; the public caller cannot select a different principal. Treat any
workflow that forwards external content into a shared knowledge source as an ingestion boundary.

**Save to R2** remains available for artifacts. It does not ingest into built-in AI Search.
The old AI Search content bucket remains bound for saved workflows and content recovery.
Move ingestion workflows to **Upload to AI Search** explicitly; existing manifests are not rewritten.

## Transition from R2 or website sources

This is a breaking source change. Existing R2 and website registry records remain visible and
exportable, marked **Migration required**. They are not available for new session selection or
MCP retrieval. Existing sessions selecting them report an unavailable source until their selection
is updated. Their instances and original content are retained. Deployment does not convert or
delete them. The source payload now accepts only `{"type":"built-in"}`.

Perform a staged copy before retiring any legacy source:

1. Export the source configuration from Admin. Keep the original registry, instance, and source
   content intact. Record existing session, bot, and workflow source references.
2. Pause writes to that source or establish a fixed content snapshot. Export the original R2
   objects using the storage-transfer procedure in [Migration](migration.md). For a website source,
   obtain original documents or an explicit crawler snapshot. Search results and indexed chunks
   are not a complete original-content export.
3. Inventory filenames, byte lengths, content types, and SHA-256 digests. Resolve filename
   collisions and names longer than 128 characters before uploading. Keep a mapping from every
   original key or URL to its destination filename. Do not flatten paths silently.
4. Create a **new** built-in source with a distinct ID and upload the inventoried originals through
   Documents or the authenticated Admin Items endpoint. Do not delete and recreate the old ID:
   that would remove the old index before verification and eliminate the rollback path.
5. Match the destination item count to the inventory and wait for each item to finish indexing.
   Verify original byte digests through Cloudflare's Items download API, then run known retrieval
   queries against the new source. Resolve all failed, unsupported, or missing items. Record the
   results without including file contents, credentials, or session cookies.
6. Update session/bot source selections and ingestion workflows to the new source ID. Run a
   workflow ingestion check and a retrieval check through the actual application.
7. Resume writers against the new source. Retain the old registry, instance, originals, snapshot,
   and mapping through the rollback window. Retire them only through an explicit, separate action.

There is no automatic crawler replacement or automatic cross-source copier in this release.
Large inventories must use a bounded operator process that checks every upload result and resumes
from its inventory. An incomplete copy must not trigger cutover. Neither configuration export nor
an accepted upload is evidence that the original content has been preserved.

The legacy content R2 resource is retained by infrastructure. Workflow artifact and skill buckets
are separate resources and are unchanged. Do not destroy these buckets as part of this transition.

## API and deployment

The administrator API provides these routes under `/api/admin/ai-search/sources/:id`:

- `GET /items?page=1`: list 50 items per page and their indexing status.
- `POST /items`: upload `{name, contentType, contentBase64}`; the decoded file is size checked.
- `DELETE /items/:itemId`: remove one document and its index entries.

Remove the obsolete external-storage token from local deployment files and GitHub secrets after
upgrading. Its former configuration reference and workflow binding have been removed. The ordinary
deployment credential still needs AI Search permissions. No account token-minting permission is
required for AI Search. Other Cloudflare products can have separate credential requirements.

Live indexing, retrieval, deletion propagation, and workflow ingestion require isolated integration
verification. See [End-to-end testing](e2e.md). Offline configuration checks cannot prove these behaviors.

Local development leaves AI Search bindings disabled by default. Set
`deployment.aiSearchEnabledInDev: true` in an explicit local profile to create stage-qualified
remote namespaces. These are real Cloudflare resources and require credentials and explicit cleanup.
The isolated verification launcher owns their lifecycle; ordinary local shutdown does not delete them.
