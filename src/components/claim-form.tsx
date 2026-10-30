"use client";

import { useRef, useState } from "react";
import { MAX_CLAIM_LENGTH, MIN_CLAIM_LENGTH } from "@/lib/thresholds";
import type { PipelineStage, SubmissionResult } from "@/lib/types";
import { Pipeline, type PipelineState } from "./pipeline";
import { ResultPanel } from "./result";

export interface DemoPrompt {
  id: number;
  prompt: string;
  kind: "paraphrase" | "novel";
}

export function ClaimForm({ examples }: { examples: DemoPrompt[] }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<PipelineState>({ phase: "idle" });
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const trimmed = text.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_CLAIM_LENGTH;
  const tooLong = trimmed.length > MAX_CLAIM_LENGTH;
  const canSubmit = trimmed.length >= MIN_CLAIM_LENGTH && !tooLong && state.phase !== "running";

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setResult(null);
    setState({ phase: "running", stages: [] });

    const stages: PipelineStage[] = [];

    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });

      if (!response.body) throw new Error("The server returned an empty response.");

      // NDJSON: one complete JSON object per line, so a partial chunk is held back until its
      // newline arrives rather than being parsed and thrown away.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          const message = JSON.parse(line);
          if (message.type === "stage") {
            stages.push(message.stage as PipelineStage);
            setState({ phase: "running", stages: [...stages] });
          } else if (message.type === "result") {
            const submission = message.result as SubmissionResult;
            setResult(submission);
            setState({ phase: "done", stages: [...stages], outcome: submission.outcome });
            requestAnimationFrame(() =>
              resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
            );
          } else if (message.type === "error") {
            setError(message.message as string);
            setState({ phase: "error", stages: [...stages] });
          }
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not reach the server. Is `npm run dev` still running?",
      );
      setState({ phase: "error", stages });
    }
  }

  function applyExample(prompt: string) {
    setText(prompt);
    setResult(null);
    setError(null);
    setState({ phase: "idle" });
    textareaRef.current?.focus();
  }

  const busy = state.phase === "running";

  return (
    <div className="space-y-5">
      <div className="panel overflow-hidden">
        <div className="relative">
          <label htmlFor="claim" className="sr-only">
            The claim you want checked
          </label>
          <textarea
            id="claim"
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter inserts a newline; the modifier submits. Claims are occasionally
              // multi-line pastes, so Enter-to-submit would eat them.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={4}
            maxLength={MAX_CLAIM_LENGTH + 200}
            disabled={busy}
            placeholder="Paste the claim you saw. &#10;e.g. &ldquo;Someone forwarded me this: the new labour law removes overtime pay entirely.&rdquo;"
            className="w-full resize-none bg-transparent px-5 py-4 text-[0.975rem] leading-relaxed text-ink placeholder:text-muted/70 focus:outline-none disabled:opacity-60"
            aria-describedby="claim-help"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-panel-2/50 px-4 py-3">
          <p id="claim-help" className="text-xs text-muted">
            {tooShort ? (
              <span className="text-verdict-mixed">
                At least {MIN_CLAIM_LENGTH} characters, so there is something to match on.
              </span>
            ) : tooLong ? (
              <span className="text-verdict-false">
                Too long &mdash; paste the single claim, not the whole article.
              </span>
            ) : (
              <>
                <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-[0.65rem]">
                  Ctrl
                </kbd>
                <span className="mx-1">+</span>
                <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-[0.65rem]">
                  Enter
                </kbd>
                <span className="ml-2">to check</span>
              </>
            )}
          </p>

          <span className="nums ml-auto text-xs text-muted">
            {trimmed.length}/{MAX_CLAIM_LENGTH}
          </span>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="relative rounded-lg bg-gradient-to-r from-brand to-cyan px-4 py-2 text-sm font-medium text-void transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:from-raised disabled:to-raised disabled:text-muted"
          >
            {busy ? "Checking..." : "Check claim"}
          </button>
        </div>
      </div>

      {examples.length > 0 && state.phase === "idle" && !result && (
        <div className="animate-fade">
          <p className="label-xs">Try one</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => applyExample(example.prompt)}
                title={
                  example.kind === "paraphrase"
                    ? "A reworded version of a claim already in the corpus -- should be matched instantly"
                    : "A claim with no counterpart in the corpus -- should go to the review queue"
                }
                className="group max-w-full rounded-lg border border-line bg-panel/60 px-3 py-2 text-left text-xs text-ink-soft transition-colors hover:border-line-bright hover:text-ink"
              >
                <span
                  className={`mr-2 inline-block size-1.5 rounded-full align-middle ${
                    example.kind === "paraphrase" ? "bg-verdict-true" : "bg-verdict-mixed"
                  }`}
                  aria-hidden
                />
                <span className="align-middle">{truncate(example.prompt, 78)}</span>
              </button>
            ))}
          </div>
          <p className="mt-2.5 text-[0.7rem] text-muted">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-verdict-true align-middle" />
            reworded from the corpus &mdash; expect an instant verdict.
            <span className="mx-1.5">&middot;</span>
            <span className="mr-1 inline-block size-1.5 rounded-full bg-verdict-mixed align-middle" />
            genuinely new &mdash; expect the review queue.
          </p>
        </div>
      )}

      {state.phase !== "idle" && <Pipeline state={state} />}

      {error && (
        <div className="panel animate-rise border-verdict-false/30 bg-verdict-false/5 p-5">
          <h2 className="text-sm font-medium text-verdict-false">Could not check that claim</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{error}</p>
          {/relation|does not exist|DATABASE_URL|pgvector|connect/i.test(error) && (
            <p className="mt-3 border-t border-verdict-false/20 pt-3 text-xs text-muted">
              This looks like a setup issue rather than a bad claim. Check that Postgres is
              running and that <code className="text-ink-soft">npm run db:setup</code> has been
              run &mdash; see the README.
            </p>
          )}
        </div>
      )}

      <div ref={resultRef}>{result && <ResultPanel result={result} />}</div>

      {result && (
        <button
          type="button"
          onClick={() => {
            setText("");
            setResult(null);
            setError(null);
            setState({ phase: "idle" });
            textareaRef.current?.focus();
          }}
          className="text-sm text-ink-soft underline decoration-line underline-offset-4 transition-colors hover:text-ink"
        >
          Check another claim
        </button>
      )}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}...`;
}
