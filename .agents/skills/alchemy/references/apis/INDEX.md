# apis index

4 pages. Every Function and Server returns { fetch, ...rpcs } — schemaless typed calls are the default for internal communication; Effect RPC and Effect HTTP add schemas where data crosses a trust boundary.

| Page | File | Covers |
| --- | --- | --- |
| APIs | `_overview.md` | Every Function and Server returns { fetch, ...rpcs } — schemaless typed calls are the default for internal communication; Effect RPC and Effect HTTP add schemas where data crosses a trust boundary. |
| Effect HTTP | `effect-http.md` | Schema-validated REST endpoints with an rpc-like typed interface — for trust boundaries where consumers want a plain HTTP client. |
| Effect RPC | `effect-rpc.md` | Schema-first RPC for trust boundaries — declare procedures, construct handler Layers, derive typed clients from the same schema. |
| Schemaless RPC | `schemaless.md` | The pattern behind typed, schema-free RPC — what an RPC member may be, how the typed client arises, how calls travel over the wire, and where the limits are. |
