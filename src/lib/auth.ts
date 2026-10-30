import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { queryOne } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, SESSION_TTL } from "./auth-constants";
import type { Role, SessionUser } from "./types";

export { SESSION_COOKIE };

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Signs a stateless session token. The role is baked into the JWT so middleware can gate
 * /review and /admin at the edge without a database round trip; every API route that
 * actually mutates data still re-checks the role against the users table.
 */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: String(user.id),
    email: user.email,
    name: user.displayName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      id: Number(payload.sub),
      email: String(payload.email ?? ""),
      displayName: String(payload.name ?? ""),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Safe to call from any server component or route handler. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Role gate for mutating endpoints. Re-reads the role from `users` rather than trusting the
 * JWT claim, so demoting an account takes effect immediately instead of when their week-old
 * token happens to expire.
 */
export async function requireRole(...allowed: Role[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("You need to sign in to do that.", 401);

  const fresh = await queryOne<{ id: number; email: string; display_name: string; role: Role }>(
    `SELECT id, email, display_name, role FROM users WHERE id = $1`,
    [session.id],
  );
  if (!fresh) throw new AuthError("Your account no longer exists.", 401);
  if (allowed.length > 0 && !allowed.includes(fresh.role)) {
    throw new AuthError(`This action requires the ${allowed.join(" or ")} role.`, 403);
  }
  return { id: fresh.id, email: fresh.email, displayName: fresh.display_name, role: fresh.role };
}

export const ROLE_LABELS: Record<Role, string> = {
  reader: "Reader",
  fact_checker: "Fact-checker",
  admin: "Admin",
};
