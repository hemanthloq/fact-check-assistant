"use client";

import { formatMs } from "@/lib/format";
import type { PipelineStage, SubmissionOutcome } from "@/lib/types";

const STAGE_ORDER = [
  { key: "embed", label: "Generate embedding", hint: "sentence-transformers, local" },
  { key: "vector", label: "Vector similarity search", hint: "cosine over the corpus" },
  { key: "fulltext", label: "Full-text fallback", hint: "tsvector / tsquery" },
  { key: "persist", label: "Record outcome", hint: "transaction" },
] as const;

type StageKey = (typeof STAGE_ORDER)[number]["key"];

export type PipelineState =
  | { phase: "idle" }
  | { phase: "running"; stages: PipelineStage[] }
  | { phase: "done"; stages: PipelineStage[]; outcome: SubmissionOutcome }
  | { phase: "error"; stages: PipelineStage[] };

/**
 * Live view of the claim pipeline.
 *
 * Each row lights up when its stage's result arrives from the stream, and shows the measured
 * duration. Stages the pipeline skipped (the full-text fallback, when the vector search
 * already cleared the threshold) are rendered struck through rather than hidden -- the fact
 * that a stage did NOT need to run is the most interesting thing the pipeline can report.
 */
export function Pipeline({ state }: { state: PipelineState }) {
  const stages = state.phase === "idle" ? [] : state.stages;
  const byKey = new Map(stages.map((stage) => [stage.key as StageKey, stage]));
  const activeIndex = stages.length;
  const running = state.phase === "running";

  const total = stages.reduce((sum, stage) => sum + stage.ms, 0);

  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label-xs">Pipeline</h2>
        {total > 0 && (
          <span className="nums text-xs text-muted">
            {total < 1000 ? `${total} ms` : `${(total / 1000).toFixed(2)} s`} total
          </span>
        )}
      </div>

      <ol className="mt-4 space-y-1">
        {STAGE_ORDER.map((definition, index) => {
          const stage = byKey.get(definition.key);
          const isActive = running && index === activeIndex;
          const skipped = stage ? !stage.ran : false;
          const done = Boolean(stage);

          return (
            <li key={definition.key} className="relative flex gap-3.5 pb-3 last:pb-0">
              {/* Connector between markers */}
              {index < STAGE_ORDER.length - 1 && (
                <span
                  className="absolute top-6 left-[0.6875rem] h-[calc(100%-0.75rem)] w-px"
                  style={{
                    background: done
                      ? "var(--color-brand)"
                      : "linear-gradient(var(--color-line), transparent)",
                    opacity: done ? 0.45 : 1,
                  }}
                  aria-hidden
                />
              )}

              <Marker done={done} active={isActive} skipped={skipped} />

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span
                    className={`text-sm font-medium ${
                      skipped
                        ? "text-muted line-through decoration-muted/50"
                        : done
                          ? "text-ink"
                          : isActive
                            ? "text-ink"
                            : "text-muted"
                    }`}
                  >
                    {stage?.label ?? definition.label}
                  </span>
                  {done && !skipped && (
                    <span className="nums text-[0.7rem] text-brand-bright">{formatMs(stage!.ms)}</span>
                  )}
                  {skipped && (
                    <span className="rounded bg-raised px-1.5 py-0.5 text-[0.65rem] text-muted">
                      skipped
                    </span>
                  )}
                </div>

                <p
                  className={`mt-0.5 truncate text-xs ${skipped ? "text-muted/70" : "text-ink-soft"}`}
                  title={stage?.detail ?? definition.hint}
                >
                  {stage?.detail ?? definition.hint}
                </p>

                {isActive && (
                  <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-raised">
                    <div className="animate-sweep h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-brand-bright to-transparent" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Marker({
  done,
  active,
  skipped,
}: {
  done: boolean;
  active: boolean;
  skipped: boolean;
}) {
  if (skipped) {
    return (
      <span className="relative mt-0.5 grid size-[1.375rem] shrink-0 place-items-center rounded-full border border-dashed border-line-bright text-muted">
        <span className="h-px w-2 bg-current" aria-hidden />
      </span>
    );
  }
  if (done) {
    return (
      <span className="relative mt-0.5 grid size-[1.375rem] shrink-0 place-items-center rounded-full bg-brand/15 text-brand-bright ring-1 ring-brand/40">
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path
            d="M2.5 6.3l2.2 2.2 4.8-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (active) {
    return (
      <span className="relative mt-0.5 grid size-[1.375rem] shrink-0 place-items-center">
        <span className="animate-pulse-ring absolute size-2.5 rounded-full bg-brand-bright" />
        <span className="size-2.5 rounded-full bg-brand-bright" />
      </span>
    );
  }
  return (
    <span className="relative mt-0.5 grid size-[1.375rem] shrink-0 place-items-center">
      <span className="size-2 rounded-full border border-line-bright" />
    </span>
  );
}
