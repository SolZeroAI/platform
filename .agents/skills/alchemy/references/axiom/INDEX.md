# axiom index

6 pages. Observability as resources — OTEL datasets, ingest tokens, monitors, notifiers, and dashboards declared next to the code that emits the data.

| Page | File | Covers |
| --- | --- | --- |
| Axiom | `_overview.md` | Observability as resources — OTEL datasets, ingest tokens, monitors, notifiers, and dashboards declared next to the code that emits the data. |
| Setup | `setup.md` | Connect alchemy to Axiom — account, credentials, and profiles. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Datasets & ingest | `data/ingest.md` | Axiom datasets per OTel signal with OTLP endpoints as outputs, least-privilege ingest tokens, and per-stage naming with Stack.useSync. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Alerting: monitors & notifiers | `guides/alerting.md` | Turn APL queries into alerts — Threshold, MatchEvent, and AnomalyDetection monitors wired to Slack, email, PagerDuty, and webhook notifiers, all as resources in your Stack. |
| Deploy markers & annotations | `guides/annotations.md` | Overlay deploys, incidents, and flag flips as vertical markers on Axiom charts — point or range annotations, scoped to one or more datasets, declared as alchemy resources. |
| Dashboards as code | `guides/dashboards.md` | Declare Axiom dashboards — charts, layout, filter bars, saved views, and deploy annotations — as alchemy resources next to the services they observe. |
