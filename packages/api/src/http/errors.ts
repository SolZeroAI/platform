import { Predicate, Schema } from "effect"

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 401 },
) {
  static is(value: unknown): value is UnauthorizedError {
    return Predicate.isTagged(value, "UnauthorizedError")
  }
}

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class BadRequestError extends Schema.TaggedError<BadRequestError>()(
  "BadRequestError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  "InternalServerError",
  {
    message: Schema.String,
    detail: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

export class UpstreamError extends Schema.TaggedError<UpstreamError>()(
  "UpstreamError",
  {
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
  },
  { httpApiStatus: 502 },
) {}

export const CommonErrors = [
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
] as const
