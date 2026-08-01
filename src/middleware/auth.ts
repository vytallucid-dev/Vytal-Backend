// ─────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE — Supabase session verification + role guards.
//
// Verifies the incoming Supabase access token (JWT, Bearer header)
// against the project's PUBLISHED ES256 public key (JWKS discovery
// endpoint), resolves it to our public.users row, and attaches
// { userId, authUserId, email, role } to req.authUser.
//
// Verification is signature + expiry + issuer + audience, algorithm
// locked to ES256 (blocks alg-confusion). This is Supabase's
// recommended path — NOT a decode-only shortcut, and NOT the
// discouraged HS256 shared-secret. The public key is fetched once,
// cached in memory, and refreshed automatically on kid rotation, so
// key rotation needs no redeploy and no secret lives in our env.
// ─────────────────────────────────────────────────────────────

import type { NextFunction, Request, Response } from "express";
import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

export interface AuthUser {
  userId: string; // public.users.id
  authUserId: string; // auth.users.id (JWT sub)
  email: string;
  role: "user" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// Typed auth failure carrying the HTTP status + a stable machine code.
class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface AuthGuardConfig {
  /** jose key resolver — remote JWKS in prod, local JWKS in tests. */
  keyResolver: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}

/**
 * Build the two guards over a given key resolver. Factored so the
 * isolation harness can exercise the exact same verify+resolve+gate
 * path against a locally-generated ES256 key.
 */
export function createAuthGuards(config: AuthGuardConfig) {
  async function authenticate(req: Request): Promise<AuthUser> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AuthError(
        401,
        "no_token",
        "Missing or malformed Authorization header",
      );
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new AuthError(401, "no_token", "Empty bearer token");

    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(token, config.keyResolver, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ["ES256"],
      });
      sub = payload.sub;
    } catch {
      // Bad signature, expired, wrong issuer/audience, or malformed — all 401.
      throw new AuthError(401, "invalid_token", "Invalid or expired token");
    }
    if (!sub) {
      throw new AuthError(401, "invalid_token", "Token missing subject claim");
    }

    // sub === auth.users.id === public.users.auth_user_id
    const user = await prisma.user.findUnique({
      where: { authUserId: sub },
      select: { id: true, authUserId: true, email: true, role: true },
    });
    if (!user) {
      // Valid JWT but no public.users row. The signup trigger creates that row
      // atomically with the auth.users insert, so a missing row is an anomaly
      // (provisioning race / manually removed) — deny rather than lazy-create,
      // especially on admin routes. Revisit with a lazy upsert only if a real
      // provisioning-lag case appears.
      throw new AuthError(401, "not_provisioned", "User not provisioned");
    }

    return {
      userId: user.id,
      authUserId: user.authUserId,
      email: user.email,
      role: user.role as AuthUser["role"],
    };
  }

  function fail(res: Response, e: unknown): void {
    if (e instanceof AuthError) {
      res.status(e.status).json({ error: e.code, message: e.message });
      return;
    }
    // Unexpected (DB down, etc.) — fail CLOSED with 500, never pass through.
    res.status(500).json({ error: "auth_error", message: "Authentication failed" });
  }

  const requireAuth = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      req.authUser = await authenticate(req);
      next();
    } catch (e) {
      fail(res, e);
    }
  };

  const requireAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = await authenticate(req);
      req.authUser = user;
      if (user.role !== "admin") {
        res
          .status(403)
          .json({ error: "forbidden", message: "Admin access required" });
        return;
      }
      next();
    } catch (e) {
      fail(res, e);
    }
  };

  // ── optionalAuth — the third guard: verify the token IF present, otherwise continue anonymous. ──
  // A surface like the relational Overview card must serve BOTH an authenticated reader and an
  // anonymous one from the SAME service (anonymous is a valid caller — M9 Stranger, orientation-only,
  // not an error path). This guard reuses the EXACT verify+resolve path above (`authenticate` — same
  // JWKS, issuer, audience, ES256 lock) so there is never a second verifier. It NEVER 401s, NEVER
  // redirects: a missing, malformed, invalid, expired, or unprovisioned token all resolve to
  // req.authUser = null and next(). A NON-AuthError (e.g. DB down during the user lookup) is logged and
  // ALSO degrades to anonymous rather than blocking the public card — the card is guaranteed-resolve.
  const optionalAuth = async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.headers.authorization) {
      req.authUser = undefined; // no token → anonymous, no work
      next();
      return;
    }
    try {
      req.authUser = await authenticate(req);
    } catch (e) {
      req.authUser = undefined; // token present but unusable → anonymous, never blocked
      if (!(e instanceof AuthError)) {
        console.warn(`[auth/optional] unexpected verify error — degrading to anonymous: ${(e as Error).message}`);
      }
    }
    next();
  };

  return { requireAuth, requireAdmin, optionalAuth };
}

// ── Production instance, bound to the Supabase project's JWKS ──
//
// ⚠ THE RESOLVER IS BUILT ON FIRST VERIFY, NOT AT MODULE LOAD, AND THAT IS LOAD-BEARING.
// `new URL()` THROWS on an unset SUPABASE_URL ("undefined/auth/v1/…" is not a URL), and it threw at
// import time — which made merely IMPORTING app.ts an environment dependency. Every consumer of
// createApp() inherited it, including verify-catalogue-endpoint.ts, a BUILD gate. A build that cannot
// construct the app without a runtime secret fails on the deploy box for a reason that has nothing to
// do with the code being built. Deferring the construction keeps the identical key path, the identical
// ES256 lock, and the identical fail-closed behaviour (an unusable issuer throws inside jwtVerify and
// `authenticate` turns it into a 401), while leaving module load env-free.
//
// The loud "you forgot SUPABASE_URL" failure did not disappear with it — it moved to where it belongs:
// server.ts asserts the required environment at boot, before the port is bound.
const issuer = `${env.SUPABASE_URL}/auth/v1`;
let jwks: JWTVerifyGetKey | undefined;
const remoteJwks: JWTVerifyGetKey = (protectedHeader, token) => {
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return jwks(protectedHeader, token);
};

export const { requireAuth, requireAdmin, optionalAuth } = createAuthGuards({
  keyResolver: remoteJwks,
  issuer,
  // Supabase user access tokens carry aud: "authenticated".
  audience: "authenticated",
});
