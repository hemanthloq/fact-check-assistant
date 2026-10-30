import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Fact-Check Assistant",
    template: "%s - Fact-Check Assistant",
  },
  description:
    "Check a claim against a corpus of already-verified claims using semantic similarity, " +
    "not keyword search. Instant verdict if it has been checked before; a review queue if not.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-void"
        >
          Skip to content
        </a>

        <Nav />

        <main id="main" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          {children}
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:px-6">
            <p>
              DBMS course project &middot; PostgreSQL + pgvector &middot; semantic claim matching
            </p>
            <nav className="flex gap-4 sm:ml-auto" aria-label="Footer">
              <Link href="/corpus" className="transition-colors hover:text-ink-soft">
                Browse corpus
              </Link>
              <Link href="/about" className="transition-colors hover:text-ink-soft">
                How it works
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
