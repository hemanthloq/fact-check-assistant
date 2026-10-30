/**
 * Shown when the app cannot reach Postgres or pgvector is missing.
 *
 * Every page that needs the database renders this instead of throwing, because the most
 * likely visitor to a fresh checkout is somebody who has not run the setup yet, and a stack
 * trace is a worse answer than the three commands they actually need.
 */
export function SetupBanner({ detail }: { detail: string }) {
  const missingExtension = /pgvector|extension/i.test(detail);
  const missingTables = /relation|does not exist/i.test(detail);
  const noUrl = /DATABASE_URL/i.test(detail);

  return (
    <div className="panel mb-8 border-verdict-mixed/30 bg-verdict-mixed/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-verdict-mixed" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-verdict-mixed">Database not ready</h2>
          <p className="mt-1.5 text-sm text-ink-soft">
            <code className="rounded bg-raised px-1.5 py-0.5 text-xs text-ink">{detail}</code>
          </p>

          <ol className="mt-4 space-y-3 text-sm text-ink-soft">
            {noUrl && (
              <Step n={1} label="Point the app at a database">
                Copy <Code>.env.example</Code> to <Code>.env.local</Code> and set{" "}
                <Code>DATABASE_URL</Code> plus <Code>AUTH_SECRET</Code>.
              </Step>
            )}
            {missingExtension && (
              <Step n={noUrl ? 2 : 1} label="Use a Postgres that has pgvector">
                Easiest route is Docker:
                <Pre>
                  docker run -d --name fca-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres
                  pgvector/pgvector:pg17
                </Pre>
                Hosted Neon and Supabase both ship pgvector as well.
              </Step>
            )}
            <Step n={missingExtension || noUrl ? 3 : 1} label="Create the schema and load the corpus">
              <Pre>npm run liar:fetch &amp;&amp; npm run db:setup</Pre>
              {missingTables && (
                <span className="mt-1 block text-xs text-muted">
                  The connection works, so this is almost certainly the step that is missing.
                </span>
              )}
            </Step>
          </ol>

          <p className="mt-4 text-xs text-muted">
            No database to hand? <Code>npm run test:db</Code> runs the whole schema and all 56
            feature tests against an in-process Postgres, no server required.
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="nums mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line-bright text-[0.65rem] text-muted">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-ink">{label}</p>
        <div className="mt-1 text-[0.8rem] leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-raised px-1.5 py-0.5 text-[0.75rem] text-ink">{children}</code>;
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-1.5 overflow-x-auto rounded-lg border border-line bg-void px-3 py-2 text-[0.7rem] leading-relaxed text-ink-soft">
      {children}
    </pre>
  );
}
