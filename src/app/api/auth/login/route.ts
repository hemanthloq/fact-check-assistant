import { NextRequest } from "next/server";
import { z } from "zod";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Enter an email and password." }, { status: 400 });
  }

  try {
    const row = await queryOne<{
      id: number;
      email: string;
      display_name: string;
      role: Role;
      password_hash: string;
    }>(
      `SELECT id, email, display_name, role, password_hash FROM users WHERE email = $1`,
      [parsed.data.email],
    );

    // One message for "no such account" and "wrong password", so the response cannot be used
    // to enumerate which emails have accounts. The bcrypt compare still runs on a dummy hash
    // when the user is missing, to keep the timing of the two paths similar.
    const hash = row?.password_hash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
    const valid = await verifyPassword(parsed.data.password, hash);

    if (!row || !valid) {
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }

    await setSessionCookie({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
    });
    return Response.json({ ok: true, role: row.role });
  } catch (error) {
    console.error("[login]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Sign-in failed." },
      { status: 500 },
    );
  }
}
