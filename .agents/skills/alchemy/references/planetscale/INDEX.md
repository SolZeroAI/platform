# planetscale index

11 pages. Declare PlanetScale Postgres and MySQL databases, branches and credentials in your Stack with Alchemy, apply migrations on deploy, and give every preview stage its own branch.

| Page | File | Covers |
| --- | --- | --- |
| PlanetScale | `_overview.md` | Declare PlanetScale Postgres and MySQL databases, branches and credentials in your Stack with Alchemy, apply migrations on deploy, and give every preview stage its own branch. |
| Organizations and tokens | `organizations-and-tokens.md` | How a PlanetScale organization holds your databases and members, how Alchemy signs in with OAuth or a service token, and how database credentials differ from deploy credentials. |
| Setup | `setup.md` | Connect alchemy to PlanetScale — account, credentials, and profiles. |
| What is PlanetScale? | `what-is-planetscale.md` | The concepts behind PlanetScale — organizations, databases, the Postgres and Vitess engines, cluster sizes, branches, credentials, connections, migrations and backups — and how @alchemy.run/planetscale models each of them. |

## data/

| Page | File | Covers |
| --- | --- | --- |
| Backups & restores | `data/backups.md` | Restore a PlanetScale backup into a fresh branch with backupId, or seed a new branch from the last successful backup with seedData. |
| Credentials | `data/credentials.md` | PlanetScale credentials as Stack resources — Postgres roles, the default role and forceReset, MySQL passwords, TTLs, CIDR allowlists, and direct vs pooled connection origins. |
| Migrations | `data/migrations.md` | Apply SQL migrations and seed data to PlanetScale databases and branches as part of every deploy — ordered, hashed, tracked, and run over short-lived credentials. |
| MySQL | `data/mysql.md` | PlanetScale MySQL (Vitess) as Stack resources — databases, branches, and passwords, with SQL migrations per branch and a straight line into Cloudflare Hyperdrive. |
| Postgres | `data/postgres.md` | PlanetScale Postgres as Stack resources — databases, branches, roles with least-privilege inherited roles, and direct vs pooled connection origins. |

## guides/

| Page | File | Covers |
| --- | --- | --- |
| Drizzle ORM with PlanetScale | `guides/drizzle.md` | Configure PlanetScale Postgres or MySQL branches, committed Drizzle migrations, and role or password connections. |
| Preview branches per PR | `guides/preview-branches.md` | Give every pull request its own PlanetScale branch — a long-lived database owned by a staging stage, referenced by ephemeral PR stages that fork, migrate, and tear down a branch each. |
