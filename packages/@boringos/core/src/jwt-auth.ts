import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * User-facing JWT auth primitives.
 *
 * The framework already issues HMAC-SHA256 JWTs for agent callbacks
 * (`@boringos/agent` → `jwt.ts`). These mirror that approach for the
 * *user* API surface — no external JWT dependency, same HS256 scheme.
 *
 * Two-token model:
 *  - **Access token** — a stateless, short-lived JWT carrying the user's
 *    id, active tenant, and role. Verified without a DB round-trip.
 *  - **Refresh token** — an opaque, high-entropy random string. Never a
 *    JWT; stored *hashed* in `auth_refresh_tokens` and rotated on use.
 *
 * Opaque UUID session tokens (the pre-existing scheme) coexist: they have
 * no dots, so `validateSession` / `createAuthMiddleware` never mistake one
 * for a JWT.
 */

export interface AccessTokenClaims {
  sub: string; // userId
  tenant_id: string;
  role: string;
  typ: "access";
  iat: number;
  exp: number;
}

const ALGORITHM = "HS256";

/** Access tokens are short-lived; clients refresh them with the refresh token. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
/** Refresh tokens are long-lived but single-use (rotated on every refresh). */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Mint a signed access token. `ttlSeconds` is overridable mainly for tests.
 */
export function signAccessToken(
  claims: { userId: string; tenantId: string; role: string },
  secret: string,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: ALGORITHM, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: claims.userId,
      tenant_id: claims.tenantId,
      role: claims.role,
      typ: "access",
      iat: now,
      exp: now + ttlSeconds,
    }),
  );

  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify an access token. Returns the claims, or null if the token is
 * malformed, not an access token, tampered with, or expired.
 *
 * Uses a constant-time signature comparison so verification time does not
 * leak how many leading bytes of a forged signature were correct.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const claims = JSON.parse(base64urlDecode(payload)) as AccessTokenClaims;
    if (claims.typ !== "access") return null;
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Generate an opaque refresh token: 256 bits of entropy, base64url-encoded.
 * Returned to the client verbatim; only its hash is persisted.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a refresh token for storage. The token already carries full entropy,
 * so a fast keyed hash is sufficient (no salt/KDF needed) — keying it with
 * the app secret means a DB-only leak can't be matched against captured
 * tokens without also knowing the secret.
 */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
