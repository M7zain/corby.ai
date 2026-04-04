import { NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionToken } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD in the server environment." },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.password !== "string" || body.password !== password) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = adminSessionToken(password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
