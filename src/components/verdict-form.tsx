"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VERDICT_META, VERDICTS, type Verdict } from "@/lib/types";
import { verdictTone } from "./verdict";

export function VerdictForm({
  claimId,
  categories,
  suggestedCategories,
}: {
  claimId: number;
  categories: { id: number; name: string }[];
  suggestedCategories: string[];
}) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [explanation, setExplanation] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [selected, setSelected] = useState<number[]>(
    categories.filter((c) => suggestedCategories.includes(c.name)).map((c) => c.id),
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/review/${claimId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Could not save that.");
        return;
      }
      router.push(`/claims/${claimId}`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (rejecting) {
    return (
      <div className="panel p-5 sm:p-6">
        <h2 className="text-sm font-medium">Reject this submission</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          For things that are not checkable factual claims &mdash; opinion, a question, nonsense.
          No verdict is recorded, and the claim stays out of the corpus so it can never answer a
          future query.
        </p>
        <label htmlFor="reason" className="label-xs mt-4 block">
          Reason (optional)
        </label>
        <textarea
          id="reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. This is an opinion, not a factual claim."
          className="mt-1.5 w-full resize-none rounded-lg border border-line bg-void px-3 py-2.5 text-sm focus:border-brand/60 focus:outline-none"
        />
        {error && <Error message={error} />}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "reject", reason: reason.trim() || null })}
            className="rounded-lg bg-verdict-false/90 px-4 py-2 text-sm font-medium text-void transition-all hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Rejecting..." : "Confirm rejection"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRejecting(false);
              setError(null);
            }}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel p-5 sm:p-6">
      <h2 className="text-sm font-medium">File a verdict</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        Saving calls <code className="text-ink-soft">sp_assign_verdict</code>, which locks the
        claim, upserts the source, records the ruling and tags the topics in one transaction. A
        trigger then publishes the claim into the corpus and computes its credibility score.
      </p>

      <fieldset className="mt-5">
        <legend className="label-xs">Verdict</legend>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {VERDICTS.map((option) => {
            const meta = VERDICT_META[option];
            const tone = verdictTone(option);
            const active = verdict === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setVerdict(option)}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                  active
                    ? `${tone.bg} ${tone.border}`
                    : "border-line hover:border-line-bright hover:bg-panel-2/60"
                }`}
              >
                <span
                  className={`flex items-center gap-2 text-sm font-medium ${active ? tone.text : "text-ink"}`}
                >
                  <span className={`size-1.5 rounded-full ${tone.dot}`} aria-hidden />
                  {meta.label}
                </span>
                <span className="mt-1 block text-[0.7rem] leading-snug text-muted">
                  {meta.blurb}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5">
        <label htmlFor="explanation" className="label-xs block">
          Explanation
        </label>
        <textarea
          id="explanation"
          rows={4}
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder="What does the evidence actually say? This is shown to every reader whose claim matches this one."
          className="mt-1.5 w-full resize-none rounded-lg border border-line bg-void px-3 py-2.5 text-sm leading-relaxed focus:border-brand/60 focus:outline-none"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="sourceUrl" className="label-xs block">
          Source URL
        </label>
        <input
          id="sourceUrl"
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://..."
          className="mt-1.5 w-full rounded-lg border border-line bg-void px-3 py-2.5 text-sm focus:border-brand/60 focus:outline-none"
        />
        <p className="mt-1 text-[0.7rem] text-muted">
          The domain becomes a row in <code className="text-ink-soft">sources</code>, and its
          reliability is 50% of the credibility score.
        </p>
      </div>

      {categories.length > 0 && (
        <fieldset className="mt-5">
          <legend className="label-xs">Topics</legend>
          {suggestedCategories.length > 0 && (
            <p className="mt-1 text-[0.7rem] text-muted">
              Pre-filled from the closest corpus match.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = selected.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setSelected((current) =>
                      active
                        ? current.filter((id) => id !== category.id)
                        : [...current, category.id],
                    )
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-brand/50 bg-brand/15 text-brand-bright"
                      : "border-line text-ink-soft hover:border-line-bright hover:text-ink"
                  }`}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {error && <Error message={error} />}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button
          type="button"
          disabled={!verdict || busy}
          onClick={() =>
            void send({
              action: "verdict",
              verdict,
              explanation: explanation.trim() || null,
              sourceUrl: sourceUrl.trim() || null,
              categoryIds: selected,
            })
          }
          className="rounded-lg bg-gradient-to-r from-brand to-cyan px-4 py-2.5 text-sm font-medium text-void transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:from-raised disabled:to-raised disabled:text-muted"
        >
          {busy ? "Saving..." : "File verdict & publish"}
        </button>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-soft transition-colors hover:border-verdict-false/40 hover:text-verdict-false"
        >
          Not a checkable claim
        </button>
        {!verdict && <p className="text-xs text-muted">Pick a verdict to continue.</p>}
      </div>
    </div>
  );
}

function Error({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 rounded-lg border border-verdict-false/30 bg-verdict-false/5 px-3 py-2 text-sm text-verdict-false"
    >
      {message}
    </p>
  );
}
