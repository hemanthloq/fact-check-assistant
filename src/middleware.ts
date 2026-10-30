import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth-constants";

/**
 * Edge gate for the two role-restricted areas.
 *
 * This is the cheap first line: it verifies the session JWT's signature and reads the role
 * claim without touching the database, so an unauthenticated request never reaches a page
 * that would run queries. It is NOT the authorisation boundary -- the role in a token is up
 * to a week old, so every route handler that actually mutates data calls requireRole(), which
 * re-reads the role from the users table. A demoted account therefore loses write access
 * immediately, even though its token still says otherwise here.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const path = request.nextUrl.pathname;
  const needsAdmin = path.startsWith("/admin");

  const signIn = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  };

  if (!token) return signIn();

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail closed: a missing secret must lock the queue, not open it.
    console.error("[middleware] AUTH_SECRET is missing or too short");
    return signIn();
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = payload.role;

    if (needsAdmin && role !== "admin") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    if (role !== "admin" && role !== "fact_checker") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  } catch {
    return signIn();
  }
}

export const config = {
  matcher: ["/review/:path*", "/admin/:path*"],
};
