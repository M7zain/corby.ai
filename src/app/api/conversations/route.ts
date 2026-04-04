import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Conversation } from "@/lib/conversation-types";
import { listConversationsForUser, replaceConversationsForUser } from "@/lib/conversations-db";
import { getMysqlPool } from "@/lib/db";

export const runtime = "nodejs";

function isConversationArray(x: unknown): x is Conversation[] {
  if (!Array.isArray(x)) {
    return false;
  }
  for (const c of x) {
    if (typeof c !== "object" || c === null) {
      return false;
    }
    const o = c as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.title !== "string") {
      return false;
    }
    if (typeof o.createdAt !== "string" || typeof o.updatedAt !== "string") {
      return false;
    }
    if (!Array.isArray(o.messages)) {
      return false;
    }
    for (const m of o.messages) {
      if (typeof m !== "object" || m === null) {
        return false;
      }
      const msg = m as Record<string, unknown>;
      if (typeof msg.id !== "string" || typeof msg.content !== "string") {
        return false;
      }
      if (msg.role !== "user" && msg.role !== "assistant") {
        return false;
      }
      if (typeof msg.createdAt !== "string") {
        return false;
      }
      if (msg.imageDataUrls !== undefined && !Array.isArray(msg.imageDataUrls)) {
        return false;
      }
    }
  }
  return true;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to load conversations." }, { status: 401 });
  }

  if (!getMysqlPool()) {
    return NextResponse.json(
      { error: "Database not configured.", conversations: [] as Conversation[] },
      { status: 503 },
    );
  }

  const rows = await listConversationsForUser(session.user.id);
  if (rows === null) {
    return NextResponse.json({ error: "Could not load conversations." }, { status: 500 });
  }

  return NextResponse.json({ conversations: rows });
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to save conversations." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const convs = (body as { conversations?: unknown }).conversations;
  if (!isConversationArray(convs)) {
    return NextResponse.json({ error: "Invalid conversations payload." }, { status: 400 });
  }

  const result = await replaceConversationsForUser(session.user.id, convs);
  if (!result.ok) {
    const status = result.error.includes("not configured")
      ? 503
      : result.error.includes("Could not save")
        ? 500
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}
