import { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  displayName: z.string().trim().min(2, "Name needs at least 2 characters.").max(80),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { email, displayName, password } = parsed.data;

  try {
    // Self-registration always creates a reader. Fact-checker and admin are granted, not
    // claimed -- otherwise anyone could sign up and start issuing verdicts.
    const row = await queryOne<{ id: number; email: string; display_name: string; role: Role }>(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'reader')
       RETURNING id, email, display_name, role`,
      [email, displayName, await hashPassword(password)],
    );
    if (!row) return Response.json({ error: "Could not create that account." }, { status: 500 });

    await setSessionCookie({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    });
    return Response.json({ ok: true, role: row.role });
  } catch (error) {
    if (error instanceof Error && /users_email_key|duplicate key/i.test(error.message)) {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    console.error("[register]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Registration failed." },
      { status: 500 },
    );
  }
}
