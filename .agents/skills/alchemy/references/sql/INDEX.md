# sql index

14 pages. Choose a database, connect with Effect SQL, Drizzle, or Prisma ORM, and deploy committed migrations.

| Page | File | Covers |
| --- | --- | --- |
| SQL | `_overview.md` | Choose a database, connect with Effect SQL, Drizzle, or Prisma ORM, and deploy committed migrations. |
| Databases | `databases.md` | Compare database engines, connection paths, and deployment guides across Alchemy's SQL providers. |

## drizzle/

| Page | File | Covers |
| --- | --- | --- |
| D1 | `drizzle/d1.md` | SQLite schemas and Effect-native Drizzle queries over a Cloudflare D1 binding. |
| Migrations | `drizzle/migrations.md` | Generate migrations when your schema changes, review and commit the SQL and snapshots, then deploy from Git. |
| MySQL | `drizzle/mysql.md` | Provider-neutral MySQL schemas, Effect-native Drizzle queries, and connection configuration. |
| Postgres | `drizzle/postgres.md` | Provider-neutral Postgres schemas, Effect-native Drizzle queries, and connections for Workers, Lambda, and servers. |

## effect-sql/

| Page | File | Covers |
| --- | --- | --- |
| D1 | `effect-sql/d1.md` | SQL.D1 wraps a bound D1 database in an @effect/sql-d1 client — tagged-template queries with typed errors over the native binding. |
| Connection lifecycle | `effect-sql/lifecycle.md` | SQL and Drizzle clients build lazily, reuse a client within the current execution scope, and release resources when that scope closes. |
| Migrations | `effect-sql/migrations.md` | Commit ordered SQL files and apply them on database deploy or Durable Object activation, tracked in one Alchemy-owned table. |
| MySQL | `effect-sql/mysql.md` | SQL.MySQL turns a connection string into an @effect/sql-mysql2 client — portable tagged-template queries with typed errors and one pool per execution. |
| Postgres | `effect-sql/postgres.md` | SQL.Postgres turns a connection string into an @effect/sql-pg client — tagged-template queries with typed errors, one pool per execution. |

## prisma/

| Page | File | Covers |
| --- | --- | --- |
| Contracts | `prisma/contracts.md` | Author Prisma ORM v8 contracts in Prisma Schema Language or TypeScript, generate optional Effect bindings and row schemas, and connect them to migrations. |
| Migrations | `prisma/migrations.md` | How Prisma.Contract and Prisma.Migrate run Prisma's contract emission, migration planning, and graph-ordered apply inside alchemy deploy. |
| Postgres | `prisma/postgres.md` | Connect Prisma ORM v8 to Postgres and run Effect-native queries, streams, prepared statements, and transactions independently of your cloud provider. |
