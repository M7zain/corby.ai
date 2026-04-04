import { NextResponse } from "next/server";
import { getMysqlPool } from "@/lib/db";
import { createUser, getUserByEmail } from "@/lib/users";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  if (!getMysqlPool()) {
    return NextResponse.json(
      { error: "Registration requires DATABASE_URL and a migrated database." },
      { status: 503 },
    );
  }

  let body: { email?: string; name?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (name.length < 1 || name.length > 191) {
    return NextResponse.json({ error: "Name must be 1–191 characters." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
  }

  try {
    await createUser({ email, name, password });
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    console.error("[register]", e);
    return NextResponse.json({ error: "Could not create account." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
