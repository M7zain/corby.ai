import { NextResponse } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3-vl:30b";

type OllamaChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatRequest = {
  messages?: OllamaChatMessage[];
};

type OllamaStreamChunk = {
  message?: { content?: string };
  done?: boolean;
  error?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const messages = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Please provide at least one message." },
        { status: 400 },
      );
    }

    const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
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
            const parts = buffer.split("\n");
            buffer = parts.pop() || "";

            for (const line of parts) {
              const chunk = line.trim();
              if (!chunk) {
                continue;
              }

              const parsed = JSON.parse(chunk) as OllamaStreamChunk;
              if (parsed.error) {
                throw new Error(parsed.error);
              }

              const token = parsed.message?.content || "";
              if (token) {
                controller.enqueue(encoder.encode(token));
              }
            }
          }

          if (buffer.trim()) {
            const parsed = JSON.parse(buffer.trim()) as OllamaStreamChunk;
            const token = parsed.message?.content || "";
            if (token) {
              controller.enqueue(encoder.encode(token));
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
