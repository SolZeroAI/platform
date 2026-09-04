import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Output from "alchemy/Output"
import * as Planetscale from "alchemy/Planetscale"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { LOCAL_PGLITE_DATABASE_URL, type AppDbMode } from "@solzero/shared"

const CLOUDFLARE_HYPERDRIVE_MIN_ORIGIN_CONNECTIONS = 5
const REMOTE_APP_CONNECTIONS = 4
const PLANETSCALE_POOLED_PORT = 6432

export interface AppPostgresHyperdriveInput {
  readonly appName: string
  readonly stageName: string
  readonly mode: AppDbMode
  readonly databaseUrl?: string
  readonly appRole?: Planetscale.PostgresRole
  readonly logicalDatabaseName?: string | Output.Output<string>
}

function parsedDatabaseUrl(raw: string) {
  const url = new URL(raw)
  const database = url.pathname.replace(/^\//, "")
  const port = Option.match(
    Option.fromNullishOr(url.port).pipe(Option.filter((value) => value.length > 0)),
    {
      onNone: () => 5432,
      onSome: (value) => Number(value),
    },
  )
  return Option.all({
    host: Option.fromNullishOr(url.hostname).pipe(Option.filter((value) => value.length > 0)),
    user: Option.fromNullishOr(url.username).pipe(Option.filter((value) => value.length > 0)),
    database: Option.fromNullishOr(database).pipe(Option.filter((value) => value.length > 0)),
  }).pipe(
    Option.map(({ host, user, database: databaseName }) => ({
      host,
      port,
      database: databaseName,
      user: decodeURIComponent(user),
      password: Redacted.make(decodeURIComponent(url.password)),
    })),
    Option.getOrThrowWith(
      () => new Error("DATABASE_URL must include host, user, and database name"),
    ),
  )
}

function localHyperdriveConnection(input: AppPostgresHyperdriveInput) {
  const origin = parsedDatabaseUrl(input.databaseUrl ?? LOCAL_PGLITE_DATABASE_URL)
  return Cloudflare.Hyperdrive.Connection("app-postgres-hyperdrive", {
    name: `${input.appName}-app-hd-${input.stageName}`,
    origin: {
      scheme: "postgres",
      host: origin.host,
      port: origin.port,
      database: origin.database,
      user: origin.user,
      password: origin.password,
    },
    caching: { disabled: true },
    originConnectionLimit: 1,
    dev: {
      scheme: "postgres",
      host: origin.host,
      port: origin.port,
      database: origin.database,
      user: origin.user,
      password: origin.password,
      sslmode: "disable",
    },
  })
}

function localHyperdrive(input: AppPostgresHyperdriveInput, context: { readonly dev: boolean }) {
  return Match.value(context.dev).pipe(
    Match.when(false, () =>
      Effect.die(
        new Error("APP_DB_MODE=local requires Alchemy dev mode and a PGLite DATABASE_URL"),
      ),
    ),
    Match.orElse(() => localHyperdriveConnection(input)),
  )
}

function remoteHyperdrive(input: AppPostgresHyperdriveInput) {
  return Option.match(Option.fromNullishOr(input.appRole), {
    onNone: () => Effect.die(new Error("PlanetScale app role is required when APP_DB_MODE=remote")),
    onSome: (appRole) =>
      Cloudflare.Hyperdrive.Connection("app-postgres-hyperdrive", {
        name: `${input.appName}-app-hd-${input.stageName}`,
        origin: {
          scheme: "postgres",
          host: appRole.pooledOrigin.host,
          port: PLANETSCALE_POOLED_PORT,
          database: input.logicalDatabaseName ?? appRole.databaseName,
          user: appRole.username,
          password: appRole.password,
        },
        originConnectionLimit: Math.max(
          REMOTE_APP_CONNECTIONS,
          CLOUDFLARE_HYPERDRIVE_MIN_ORIGIN_CONNECTIONS,
        ),
      }),
  })
}

export function createAppPostgresHyperdrive(input: AppPostgresHyperdriveInput) {
  return Effect.gen(function* () {
    const context = yield* Alchemy.AlchemyContext
    return yield* Match.value(input.mode).pipe(
      Match.when("local", () => localHyperdrive(input, context)),
      Match.orElse(() => remoteHyperdrive(input)),
    )
  })
}
