---
packages:
  "release:solzero": major
---

## Upload documents directly to AI Search

AI Search sources now use built-in storage. Administrators can upload and delete documents and
inspect indexing status without an external-storage service token. Workflows can ingest text and
JSON with the new Upload to AI Search node.

R2 and website source creation is removed. Existing source records and original content remain
intact and are marked as requiring migration; these sources are unavailable for retrieval until
operators copy their originals into new built-in sources and update their selections. Follow
`docs/ai-search.md` before cutover. Deployment does not copy or delete legacy content. Workflow
artifact and skill storage remain unchanged.
