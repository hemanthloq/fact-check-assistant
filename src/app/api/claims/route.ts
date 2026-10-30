import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ClaimInputError, submitClaim } from "@/lib/claims";
import type { PipelineStage } from "@/lib/types";

/** The embedding model lives in-process and takes ~20s to load, so this must not run on edge. */
export const runtime = "nodejs";
/** A cold model load plus a vector scan can exceed the default budget on a large corpus. */
export const maxDuration = 60;

/**
 * Claim submission, streamed as NDJSON.
 *
 * One line per pipeline stage, flushed the moment that stage finishes, then a final result
 * line. The reason for streaming rather than returning one JSON blob: the pipeline is the
 * thing worth understanding here, and a progress animation driven by real stage completions
 * is honest about where the time actually goes (embedding dominates; the vector search is
 * usually single-digit milliseconds). A spinner would hide exactly the interesting part.
 */
export async function POST(request: NextRequest) {
  let text: string;
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return Response.json({ error: "Expected a JSON body with a `text` field." }, { status: 400 });
  }

  const session = await getSession();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const result = await submitClaim(text, session?.id ?? null, {
          onStage: (stage: PipelineStage) => send({ type: "stage", stage }),
        });
        send({ type: "result", result });
      } catch (error) {
        if (error instanceof ClaimInputError) {
          send({ type: "error", message: error.message, kind: "input" });
        } else {
          // Surface the database's own message: for this project, "pgvector is not installed"
          // or "relation claims does not exist" is the useful thing to read, not "500".
          console.error("[submit]", error);
          send({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Something went wrong while checking that claim.",
            kind: "server",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Tells nginx and friends not to buffer the stream back into one response.
      "X-Accel-Buffering": "no",
    },
  });
}
