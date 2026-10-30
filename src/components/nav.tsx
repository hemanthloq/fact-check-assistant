import Link from "next/link";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/auth";
import { Wordmark } from "./brand";
import { NavLinks, SignOutButton } from "./nav-client";

/**
 * Top bar. A server component so the links a visitor sees are decided by their actual
 * session rather than by client-side state that could flash the wrong nav on load.
 */
export async function Nav() {
  const session = await getSession();
  const canReview = session?.role === "fact_checker" || session?.role === "admin";

  let pendingCount = 0;
  if (canReview) {
    try {
      const row = await queryOne<{ n: number }>(
        `SELECT count(*)::INT AS n FROM claims WHERE status = 'pending'`,
      );
      pendingCount = row?.n ?? 0;
    } catch {
      // The banner on the page already reports a database that is down; the nav just
      // shouldn't be the thing that takes the whole page with it.
    }
  }

  const links = [
    { href: "/", label: "Check a claim" },
    { href: "/corpus", label: "Corpus" },
    ...(canReview ? [{ href: "/review", label: "Review queue", badge: pendingCount }] : []),
    ...(session?.role === "admin" ? [{ href: "/admin", label: "Dashboard" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="rounded-lg transition-opacity hover:opacity-80">
          <Wordmark />
        </Link>

        <NavLinks links={links} />

        <div className="ml-auto flex items-center gap-3">
          {session ? (
            <>
              <div className="hidden text-right sm:block">
                <div className="text-[0.8rem] leading-tight font-medium">{session.displayName}</div>
                <div className="text-[0.7rem] leading-tight text-muted">
                  {ROLE_LABELS[session.role]}
                </div>
              </div>
              <div
                className="grid size-9 place-items-center rounded-full border border-line-bright bg-raised text-xs font-semibold text-ink-soft"
                aria-hidden
              >
                {initials(session.displayName)}
              </div>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-sm text-ink-soft transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-void transition-opacity hover:opacity-90"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
