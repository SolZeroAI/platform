import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

const DOTENV_NAME_PATTERN = /^[\w.-]+$/

export class DotenvExportError extends Schema.TaggedErrorClass<DotenvExportError>()(
  "DotenvExportError",
  {
    message: Schema.String,
  },
) {}

const failExport = (message: string) => Result.fail(new DotenvExportError({ message }))

function quoteDotenvValue(value: string): Result.Result<string, DotenvExportError> {
  return Match.value(value).pipe(
    Match.when(
      (candidate) => candidate.includes("\r"),
      () => failExport("Dotenv values containing carriage returns cannot be exported losslessly"),
    ),
    Match.when(
      (candidate) => !candidate.includes("'"),
      (candidate) => Result.succeed(`'${candidate}'`),
    ),
    Match.when(
      (candidate) => !candidate.includes("`"),
      (candidate) => Result.succeed(`\`${candidate}\``),
    ),
    Match.when(
      (candidate) => !candidate.includes('"') && !/\\[nr]/.test(candidate),
      (candidate) => Result.succeed(`"${candidate}"`),
    ),
    Match.when(
      (candidate) => candidate === candidate.trim() && !/[#\r\n]/.test(candidate),
      (candidate) => Result.succeed(candidate),
    ),
    Match.orElse(() =>
      failExport("Dotenv value cannot be represented without changing its contents"),
    ),
  )
}

export const dotenvAssignment = Effect.fn("dotenv.assignment")((name: string, value: string) =>
  Effect.fromResult(
    Result.gen(function* () {
      const variableName = yield* Result.liftPredicate(
        name,
        (candidate) => DOTENV_NAME_PATTERN.test(candidate),
        (candidate) =>
          new DotenvExportError({ message: `Invalid dotenv variable name '${candidate}'` }),
      )
      return `${variableName}=${yield* quoteDotenvValue(value)}`
    }),
  ),
)
