"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NavLinks({
  links,
}: {
  links: { href: string; label: string; badge?: number }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {links.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-2">
              {link.label}
              {link.badge !== undefined && link.badge > 0 && (
                <span className="nums rounded-full bg-brand/20 px-1.5 py-0.5 text-[0.65rem] font-semibold text-brand-bright">
                  {link.badge > 99 ? "99+" : link.badge}
                </span>
              )}
            </span>
            {active && (
              <span className="absolute inset-x-3 -bottom-[1.3rem] h-[2px] rounded-full bg-gradient-to-r from-brand to-cyan" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    startTransition(() => {
      router.replace("/");
      router.refresh();
    });
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy || pending}
      className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink disabled:opacity-50"
    >
      {busy || pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
