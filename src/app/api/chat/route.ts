import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ALLOWED_CHAT_MODEL_IDS } from "@/lib/chat-models";
import { logUserQuestion } from "@/lib/chat-log";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "corby:latest";

type OllamaChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  /** Base64-encoded image bytes (no data: prefix), per Ollama chat API. */
  images?: string[];
};

type ChatRequest = {
  messages?: OllamaChatMessage[];
  /** When true, Ollama sends model “thinking” (e.g. DeepSeek-R1 style). */
  think?: boolean;
  /** Must be in ALLOWED_CHAT_MODEL_IDS; otherwise server falls back to OLLAMA_MODEL. */
  model?: string;
};

type OllamaStreamChunk = {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  error?: string;
};

function normalizeStreamLine(line: string): string {
  let s = line.trim();
  if (!s) {
    return "";
  }
  if (s.startsWith("data:")) {
    s = s.slice(5).trim();
  }
  return s;
}

function tryParseOllamaChunk(line: string): OllamaStreamChunk | null {
  const s = normalizeStreamLine(line);
  if (!s) {
    return null;
  }
  try {
    return JSON.parse(s) as OllamaStreamChunk;
  } catch {
    return null;
  }
}

function enqueueTokens(
  parsed: OllamaStreamChunk,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  const thinking = parsed.message?.thinking || "";
  const token = parsed.message?.content || "";
  const out = `${thinking}${token}`;
  if (out) {
    controller.enqueue(encoder.encode(out));
  }
}

/** When JSON.parse fails: forward plain-text tails (some proxies/models append non-JSON). */
function maybeEnqueuePlainTextTail(
  raw: string,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
) {
  const t = raw.trim();
  if (!t || t.startsWith("{") || t.startsWith("[")) {
    return;
  }
  controller.enqueue(encoder.encode(t));
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Sign in to chat." }, { status: 401 });
    }
    const userClientId = session.user.id.slice(0, 128);

    let logEmail =
      typeof session.user.email === "string" && session.user.email.trim()
        ? session.user.email.trim().toLowerCase()
        : null;
    let logName: string | null =
      typeof session.user.name === "string" && session.user.name.trim()
        ? session.user.name.trim()
        : null;
    if (!logEmail && session.user.id) {
      const { getUserById } = await import("@/lib/users");
      const row = await getUserById(session.user.id);
      if (row) {
        logEmail = row.email.trim().toLowerCase();
        logName = logName ?? row.name;
      }
    }

    const body = (await request.json()) as ChatRequest;
    const messages = body.messages || [];
    const think = body.think === true;
    const requestedModel =
      typeof body.model === "string" && ALLOWED_CHAT_MODEL_IDS.has(body.model)
        ? body.model
        : OLLAMA_MODEL;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Please provide at least one message." },
        { status: 400 },
      );
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser?.content?.trim()) {
      const imgs = lastUser.images?.filter((s) => typeof s === "string" && s.length > 0) ?? [];
      void logUserQuestion({
        clientId: userClientId,
        userEmail: logEmail,
        userName: logName,
        model: requestedModel,
        question: lastUser.content.trim(),
        hasImage: imgs.length > 0,
        imagesBase64: imgs.length > 0 ? imgs : null,
      });
    }

    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: requestedModel,
        messages,
        stream: true,
        think,
      }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Ollama request failed: ${text || upstream.statusText}` },
        { status: 502 },
      );
    }

    if (!upstream.body) {
      return NextResponse.json({ error: "Ollama stream not available." }, { status: 502 });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let buffer = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split(/\r?\n/);
            buffer = parts.pop() || "";

            for (const line of parts) {
              const parsed = tryParseOllamaChunk(line);
              if (parsed) {
                enqueueTokens(parsed, encoder, controller);
              }
            }
          }

          const tail = buffer.trim();
          if (tail) {
            const parsed = tryParseOllamaChunk(tail);
            if (parsed) {
              enqueueTokens(parsed, encoder, controller);
            } else {
              maybeEnqueuePlainTextTail(tail, encoder, controller);
            }
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
