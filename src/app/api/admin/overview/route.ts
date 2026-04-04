import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  countImagesInStoredJson,
  parseStoredImagesJsonToDataUrls,
  readAllQuestionEvents,
  summarizeByClient,
} from "@/lib/chat-log";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await readAllQuestionEvents();
  const clients = summarizeByClient(events);
  const recent = [...events]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 100)
    .map((e) => ({
      at: e.at,
      clientId: e.clientId,
      userEmail: e.userEmail,
      userName: e.userName,
      model: e.model,
      preview: e.question.length > 160 ? `${e.question.slice(0, 160)}…` : e.question,
      hasImage: e.hasImage,
      imageCount: countImagesInStoredJson(e.imagesBase64Json),
      imagesDataUrls: parseStoredImagesJsonToDataUrls(e.imagesBase64Json),
    }));

  return NextResponse.json({
    totalQuestions: events.length,
    uniqueClients: clients.length,
    clients,
    recent,
  });
}
