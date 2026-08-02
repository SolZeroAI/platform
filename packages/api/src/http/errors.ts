import { Predicate, Schema } from "effect"

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
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

export class ForbiddenError extends Schema.TaggedErrorClass<ForbiddenError>()(
  "ForbiddenError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class BadRequestError extends Schema.TaggedErrorClass<BadRequestError>()(
  "BadRequestError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "ConflictError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  "InternalServerError",
  {
    message: Schema.String,
    detail: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

export class UpstreamError extends Schema.TaggedErrorClass<UpstreamError>()(
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
