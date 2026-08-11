import { SignJWT, jwtVerify } from "jose"
import { MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH } from "@solzero/shared"

const ALGORITHM = "HS256"
const ISSUER = "s0-api"
const AUDIENCE = "mcpcf"
const DEFAULT_TTL_SECONDS = 60 * 60

function signingKey(secret: string): Uint8Array {
  const normalized = secret.trim()
  if (normalized.length < MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH) {
    throw new Error(
      `MCPCF_PROXY_SIGNING_SECRET must contain at least ${MCPCF_PROXY_SIGNING_SECRET_MIN_LENGTH} characters`,
    )
  }
  return new TextEncoder().encode(normalized)
}

export async function issueMcpcfProxyCapability(
  secret: string,
  sessionId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const subject = sessionId.trim()
  if (!subject) {
    throw new Error("Cannot issue an MCP Context Forge capability without a session id")
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(subject)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey(secret))
}

export async function verifyMcpcfProxyCapability(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, signingKey(secret), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  if (!payload.sub?.trim()) {
    throw new Error("MCP Context Forge capability is missing its session subject")
  }
  return payload.sub
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim()
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing MCP Context Forge capability")
  }
  const token = authorization.slice("Bearer ".length).trim()
  if (!token) {
    throw new Error("Missing MCP Context Forge capability")
  }
  return token
}

export function verifyMcpcfProxyCapabilityRequest(
  request: Request,
  secret: string,
): Promise<string> {
  return verifyMcpcfProxyCapability(bearerToken(request), secret)
}
