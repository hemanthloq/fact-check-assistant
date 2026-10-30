"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { VERDICT_META, VERDICTS } from "@/lib/types";

/**
 * Corpus filters. Everything lives in the URL rather than component state, so a filtered view
 * is a link somebody can share, and the server component does the querying.
 */
export function CorpusControls({ categories }: { categories: { name: string; slug: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");

  // Keep the box in step with back/forward navigation.
  useEffect(() => {
    setDraft(params.get("q") ?? "");
  }, [params]);

  function navigate(next: URLSearchParams) {
    next.delete("page");
    const query = next.toString();
    router.push(query ? `/corpus?${query}` : "/corpus");
  }

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(next);
  }

  const activeVerdict = params.get("verdict");
  const activeCategory = params.get("category");
  const hasFilters = Boolean(activeVerdict || activeCategory || params.get("q"));

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setParam("q", draft.trim() || null);
        }}
        className="panel flex items-center gap-2 p-1.5"
        role="search"
      >
        <label htmlFor="corpus-q" className="sr-only">
          Search the corpus by meaning
        </label>
        <input
          id="corpus-q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search by meaning, not keywords -- describe the claim"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
        />
        {draft && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setParam("q", null);
            }}
            className="rounded-lg px-2 py-2 text-xs text-muted transition-colors hover:text-ink"
          >
            Clear
          </button>
        )}
        <button
          type="submit"
          className="rounded-lg bg-gradient-to-r from-brand to-cyan px-3.5 py-2 text-sm font-medium text-void transition-all hover:brightness-110"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-xs">Verdict</span>
        <Chip active={!activeVerdict} onClick={() => setParam("verdict", null)}>
          Any
        </Chip>
        {VERDICTS.map((verdict) => (
          <Chip
            key={verdict}
            active={activeVerdict === verdict}
            onClick={() => setParam("verdict", activeVerdict === verdict ? null : verdict)}
          >
            {VERDICT_META[verdict].short}
          </Chip>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-xs">Topic</span>
          <Chip active={!activeCategory} onClick={() => setParam("category", null)}>
            All
          </Chip>
          {categories.map((category) => (
            <Chip
              key={category.slug}
              active={activeCategory === category.name}
              onClick={() =>
                setParam("category", activeCategory === category.name ? null : category.name)
              }
            >
              {category.name}
            </Chip>
          ))}
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => router.push("/corpus")}
          className="text-xs text-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink"
        >
          Reset everything
        </button>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-brand/50 bg-brand/15 text-brand-bright"
          : "border-line text-ink-soft hover:border-line-bright hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
