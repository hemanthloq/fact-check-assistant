import { NextRequest } from "next/server";
import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth";
import { assignVerdict, rejectClaim } from "@/lib/claims";
import { VERDICTS } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("verdict"),
    verdict: z.enum(VERDICTS as [string, ...string[]]),
    explanation: z.string().trim().max(4000).optional().nullable(),
    sourceUrl: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .nullable()
      .refine(
        (value) => !value || /^https?:\/\/\S+\.\S+/i.test(value),
        "Give a full http(s) URL, or leave it blank.",
      ),
    categoryIds: z.array(z.number().int().positive()).max(12).default([]),
  }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim().max(1000).optional().nullable(),
  }),
]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Role is re-read from the database here, not taken from the JWT -- the middleware gate is
    // only a cheap filter, this is the actual authorisation boundary.
    const reviewer = await requireRole("fact_checker", "admin");

    const { id } = await context.params;
    const claimId = Number.parseInt(id, 10);
    if (!Number.isFinite(claimId)) {
      return Response.json({ error: "Bad claim id." }, { status: 400 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    if (parsed.data.action === "reject") {
      await rejectClaim(claimId, reviewer.id, parsed.data.reason ?? null);
      return Response.json({ ok: true, outcome: "rejected" });
    }

    await assignVerdict({
      claimId,
      reviewerId: reviewer.id,
      verdict: parsed.data.verdict as (typeof VERDICTS)[number],
      explanation: parsed.data.explanation ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      categoryIds: parsed.data.categoryIds,
    });
    return Response.json({ ok: true, outcome: "reviewed" });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    // The stored procedures raise meaningful errors for the states a reviewer can actually hit
    // (somebody else already ruled on it, the claim was auto-matched). Those are worth showing
    // verbatim rather than flattening into a generic 500.
    const message = error instanceof Error ? error.message : "Could not save that verdict.";
    const expected = /auto-resolved|does not exist|only pending claims/i.test(message);
    if (!expected) console.error("[review]", error);

    return Response.json({ error: message }, { status: expected ? 409 : 500 });
  }
}
