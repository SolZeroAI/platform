# gcp index

6 pages. Google Cloud in one Effect program — Cloud Run services and jobs, Firestore, Pub/Sub, BigQuery, Secret Manager, and Memorystore, with IAM granted by the bindings themselves.

| Page | File | Covers |
| --- | --- | --- |
| GCP | `_overview.md` | Google Cloud in one Effect program — Cloud Run services and jobs, Firestore, Pub/Sub, BigQuery, Secret Manager, and Memorystore, with IAM granted by the bindings themselves. |
| Setup | `setup.md` | Connect alchemy to Google Cloud — project, service-account key, the APIs to enable, and Docker. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| How bindings grant IAM | `guides/bindings.md` | What a yield* of a GCP binding actually does — the per-host service account, the role it grants, and how removing a binding revokes it. |
| Serve an API on Cloud Run | `guides/cloud-run-api.md` | A link shortener on one Cloud Run service — Firestore for state, Secret Manager for the API key, and IAM granted by the bindings themselves. |
| Ingest events into BigQuery | `guides/event-pipeline.md` | A Cloud Run service publishes to Pub/Sub, a Cloud Run Job drains the subscription into BigQuery, and one host triggers the other. |
| Cache with Memorystore | `guides/memorystore.md` | Bind a Memorystore Redis instance to a Cloud Run service over Direct VPC egress, and what to expect from create and destroy times. |
