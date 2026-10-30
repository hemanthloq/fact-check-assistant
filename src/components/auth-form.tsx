"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DEMO_ACCOUNTS = [
  { email: "reader@demo.local", role: "Reader", blurb: "submit claims, read verdicts" },
  { email: "priya@demo.local", role: "Fact-checker", blurb: "work the review queue" },
  { email: "admin@demo.local", role: "Admin", blurb: "sources, categories, dashboard" },
];
const DEMO_PASSWORD = "demo1234";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLogin = mode === "login";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLogin ? { email, password } : { email, displayName, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      // Fact-checkers and admins land where their work is; readers land on the form.
      const destination =
        data.role === "admin" ? "/admin" : data.role === "fact_checker" ? "/review" : "/";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-md pt-16 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isLogin ? "Sign in" : "Create an account"}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        {isLogin
          ? "Fact-checkers and admins sign in here. Readers can submit claims without an account."
          : "New accounts are readers. Fact-checker and admin roles are granted by an admin, not chosen at sign-up."}
      </p>

      <form onSubmit={submit} className="panel mt-6 space-y-4 p-6">
        {!isLogin && (
          <Field
            id="displayName"
            label="Name"
            value={displayName}
            onChange={setDisplayName}
            autoComplete="name"
            required
          />
        )}
        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={isLogin ? "current-password" : "new-password"}
          hint={isLogin ? undefined : "At least 8 characters."}
          required
        />

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-verdict-false/30 bg-verdict-false/5 px-3 py-2 text-sm text-verdict-false"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-gradient-to-r from-brand to-cyan py-2.5 text-sm font-medium text-void transition-all hover:brightness-110 disabled:opacity-60"
        >
          {busy ? "Working..." : isLogin ? "Sign in" : "Create account"}
        </button>

        <p className="text-center text-xs text-muted">
          {isLogin ? (
            <>
              No account?{" "}
              <Link href="/register" className="text-brand-bright underline underline-offset-4">
                Create one
              </Link>
            </>
          ) : (
            <>
              Already registered?{" "}
              <Link href="/login" className="text-brand-bright underline underline-offset-4">
                Sign in
              </Link>
            </>
          )}
        </p>
      </form>

      {isLogin && (
        <div className="panel mt-4 p-5">
          <h2 className="label-xs">Seeded demo accounts</h2>
          <p className="mt-2 text-xs text-muted">
            Created by <code className="text-ink-soft">npm run db:seed</code>. Password is{" "}
            <code className="text-ink-soft">{DEMO_PASSWORD}</code> for all three.
          </p>
          <ul className="mt-3 space-y-2">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => fillDemo(account.email)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-line-bright"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{account.email}</span>
                    <span className="block text-[0.7rem] text-muted">{account.blurb}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[0.65rem] text-ink-soft">
                    {account.role}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="label-xs block">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-line bg-void px-3 py-2.5 text-sm text-ink transition-colors placeholder:text-muted focus:border-brand/60 focus:outline-none"
      />
      {hint && <p className="mt-1 text-[0.7rem] text-muted">{hint}</p>}
    </div>
  );
}
