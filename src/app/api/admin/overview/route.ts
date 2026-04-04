import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifyAdminSessionCookie } from "@/lib/admin-auth";
import { readAllQuestionEvents, summarizeByClient } from "@/lib/chat-log";

export async function GET() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD is not set on the server." },
      { status: 503 },
    );
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!verifyAdminSessionCookie(session, password)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await readAllQuestionEvents();
  const clients = summarizeByClient(events);
  const recent = [...events]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 100)
    .map((e) => ({
      at: e.at,
      clientId: e.clientId,
      model: e.model,
      preview: e.question.length > 160 ? `${e.question.slice(0, 160)}…` : e.question,
      hasImage: e.hasImage,
    }));

  return NextResponse.json({
    totalQuestions: events.length,
    uniqueClients: clients.length,
    clients,
    recent,
  });
}
