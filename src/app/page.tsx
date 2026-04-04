"use client";

import { type ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CHAT_MODELS, VISION_MODEL_ID } from "@/lib/chat-models";

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  /** Data URLs for display & storage; sent as raw base64 when using the vision model. */
  imageDataUrls?: string[];
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

const STORAGE_KEY = "corby-ai-conversations";
/** Opt-in only; older key `corby-ai-think-enabled` is cleared on load so thinking stays off by default. */
const THINK_OPT_IN_KEY = "corby-ai-think-opt-in";
const SELECTED_MODEL_KEY = "corby-ai-selected-model";
/** Sent with each chat request so the admin dashboard can group questions by browser. */
const CLIENT_ID_KEY = "corby-client-id";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Downscale camera shots so the UI stays responsive and payloads stay reasonable. */
const IMAGE_MAX_EDGE_PX = 1792;
const JPEG_QUALITY = 0.82;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getOrCreateClientId(): string {
  if (typeof window === "undefined") {
    return "anonymous";
  }
  let id = window.localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = uid();
    window.localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function shortTitleFromMessage(message: string) {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 40 ? `${clean.slice(0, 40)}...` : clean || "New chat";
}

type ContentBlock =
  | { type: "text"; value: string }
  | { type: "code"; language: string; value: string };

function parseContentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const codePattern = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while (true) {
    match = codePattern.exec(content);
    if (!match) {
      break;
    }

    const [fullMatch, language, code] = match;
    const start = match.index;
    if (start > lastIndex) {
      blocks.push({
        type: "text",
        value: content.slice(lastIndex, start),
      });
    }

    blocks.push({
      type: "code",
      language: language || "code",
      value: code.trimEnd(),
    });
    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: "text",
      value: content.slice(lastIndex),
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", value: content }];
}

function dataUrlToBase64(dataUrl: string): string {
  const marker = "base64,";
  const idx = dataUrl.indexOf(marker);
  if (idx !== -1) {
    return dataUrl.slice(idx + marker.length);
  }
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function toApiMessages(messages: ChatMessage[], model: string) {
  const allowImages = model === VISION_MODEL_ID;
  return messages.map((m) => {
    const row: { role: Role; content: string; images?: string[] } = {
      role: m.role,
      content: m.content,
    };
    if (allowImages && m.imageDataUrls?.length) {
      row.images = m.imageDataUrls.map(dataUrlToBase64);
    }
    return row;
  });
}

function isProbablyImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }
  if (!file.type || file.type === "application/octet-stream") {
    return /\.(jpe?g|png|gif|webp|heif|heic|bmp)$/i.test(file.name);
  }
  return false;
}

/**
 * Camera photos are huge; reading them as one giant data URL freezes mobile browsers.
 * Decode from a blob URL, draw scaled to canvas, export JPEG.
 */
async function compressImageFileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    if (typeof img.decode === "function") {
      await img.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode"));
      });
    }

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) {
      throw new Error("bad dims");
    }

    const scale = Math.min(1, IMAGE_MAX_EDGE_PX / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new Error("no ctx");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, tw, th);

    let dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (dataUrl.length > 4_200_000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.68);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") {
        resolve(r);
      } else {
        reject(new Error("read"));
      }
    };
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [thinkEnabled, setThinkEnabled] = useState(false);
  const [selectedModel, setSelectedModel] = useState(CHAT_MODELS[0].id);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamAccumRef = useRef("");
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);

  useEffect(() => {
    window.localStorage.removeItem("corby-ai-think-enabled");
    if (window.localStorage.getItem(THINK_OPT_IN_KEY) === "true") {
      setThinkEnabled(true);
    }
    const savedModel = window.localStorage.getItem(SELECTED_MODEL_KEY);
    if (savedModel && CHAT_MODELS.some((m) => m.id === savedModel)) {
      setSelectedModel(savedModel);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THINK_OPT_IN_KEY, thinkEnabled ? "true" : "false");
  }, [thinkEnabled]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_MODEL_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (selectedModel !== VISION_MODEL_ID) {
      setPendingImageDataUrl(null);
    }
  }, [selectedModel]);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const starter: Conversation = {
        id: uid(),
        title: "New chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      setConversations([starter]);
      setActiveId(starter.id);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Conversation[];
      if (parsed.length === 0) {
        throw new Error("No conversations");
      }
      setConversations(parsed);
      setActiveId(parsed[0].id);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (conversations.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  useEffect(() => {
    if (!isLoading) {
      setThinkingSeconds(0);
      return;
    }

    const timer = window.setInterval(() => {
      setThinkingSeconds((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isLoading]);

  const activeConversation = useMemo(
    () => conversations.find((chat) => chat.id === activeId) ?? null,
    [activeId, conversations],
  );

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) {
      return;
    }
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
  }, [
    activeConversation?.messages.length,
    streamingReply,
    activeId,
    isLoading,
  ]);

  function createConversation() {
    const fresh: Conversation = {
      id: uid(),
      title: "New chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setConversations((prev) => [fresh, ...prev]);
    setActiveId(fresh.id);
    setError(null);
  }

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (next.length === 0) {
        const fallback: Conversation = {
          id: uid(),
          title: "New chat",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        setActiveId(fallback.id);
        return [fallback];
      }
      if (activeId === id) {
        setActiveId(next[0].id);
      }
      return next;
    });
  }

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!isProbablyImageFile(file)) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image must be under ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
      return;
    }

    setIsCompressingPhoto(true);
    setError(null);

    await new Promise<void>((r) => {
      requestAnimationFrame(() => r());
    });

    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setPendingImageDataUrl(dataUrl);
    } catch {
      try {
        const fallback = await readFileAsDataUrl(file);
        setPendingImageDataUrl(fallback);
      } catch {
        setError("Could not process that photo. Try again or pick from your gallery.");
      }
    } finally {
      setIsCompressingPhoto(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    const hasVisionImage =
      selectedModel === VISION_MODEL_ID && pendingImageDataUrl !== null;
    if ((!text && !hasVisionImage) || !activeConversation || isLoading || isCompressingPhoto) {
      return;
    }

    const userContent = text || "What do you see in this image? Describe it clearly.";
    const imageUrls =
      selectedModel === VISION_MODEL_ID && pendingImageDataUrl
        ? [pendingImageDataUrl]
        : undefined;

    setPendingImageDataUrl(null);

    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
      ...(imageUrls ? { imageDataUrls: imageUrls } : {}),
    };

    const updatedMessages = [...activeConversation.messages, userMessage];
    const chatTitle =
      activeConversation.title === "New chat"
        ? shortTitleFromMessage(userContent)
        : activeConversation.title;

    const chatId = activeConversation.id;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamAccumRef.current = "";

    setInput("");
    setError(null);
    setIsLoading(true);
    setStreamingReply("");

    setConversations((prev) =>
      prev.map((chat) =>
        chat.id === activeConversation.id
          ? {
              ...chat,
              title: chatTitle,
              messages: updatedMessages,
              updatedAt: new Date().toISOString(),
            }
          : chat,
      ),
    );

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: toApiMessages(updatedMessages, selectedModel),
          think: thinkEnabled,
          model: selectedModel,
          clientId: getOrCreateClientId(),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error || "Failed to reach corby.ai");
      }

      if (!response.body) {
        throw new Error("No stream returned from corby.ai");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let finalMessage = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) {
          continue;
        }
        finalMessage += chunk;
        streamAccumRef.current = finalMessage;
        setStreamingReply(finalMessage);
      }

      if (!finalMessage.trim()) {
        throw new Error("corby.ai returned an empty response");
      }

      const assistantMessage: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: finalMessage,
        createdAt: new Date().toISOString(),
      };

      setConversations((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, assistantMessage],
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        const partial = streamAccumRef.current.trim();
        if (partial) {
          const assistantMessage: ChatMessage = {
            id: uid(),
            role: "assistant",
            content: `${partial}\n\n_(stopped)_`,
            createdAt: new Date().toISOString(),
          };
          setConversations((prev) =>
            prev.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: [...chat.messages, assistantMessage],
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          );
        }
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      abortRef.current = null;
      streamAccumRef.current = "";
      setIsLoading(false);
      setStreamingReply("");
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  const thinkingLabel =
    thinkingSeconds < 6
      ? "Reading your prompt..."
      : thinkingSeconds < 14
        ? "Analyzing context..."
        : "Drafting a detailed response...";

  const selectedModelLabel =
    CHAT_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel;

  async function copyCode(snippetId: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSnippetId(snippetId);
      window.setTimeout(() => {
        setCopiedSnippetId((prev) => (prev === snippetId ? null : prev));
      }, 1600);
    } catch {
      setError("Could not copy code to clipboard.");
    }
  }

  function renderMessageContent(content: string, messageId: string) {
    const blocks = parseContentBlocks(content);
    return (
      <div className="space-y-3">
        {blocks.map((block, index) => {
          const snippetId = `${messageId}-${index}`;
          if (block.type === "code") {
            return (
              <div
                key={snippetId}
                className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950"
              >
                <div className="flex min-h-11 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
                  <span className="truncate text-xs uppercase tracking-wider text-zinc-400">
                    {block.language}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyCode(snippetId, block.value)}
                    className="min-h-10 shrink-0 touch-manipulation rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition active:bg-zinc-800 hover:bg-zinc-800 sm:min-h-9 sm:py-1.5"
                  >
                    {copiedSnippetId === snippetId ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto overscroll-x-contain px-3 py-3 text-[12px] leading-6 text-emerald-300 sm:px-4 sm:text-[13px]">
                  <code>{block.value}</code>
                </pre>
              </div>
            );
          }

          return (
            <p key={snippetId} className="break-words whitespace-pre-wrap">
              {block.value}
            </p>
          );
        })}
      </div>
    );
  }

  function renderConversationsList(isMobile = false) {
    return conversations.map((chat) => (
      <div
        key={chat.id}
        className={`group flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 py-2 touch-manipulation ${
          chat.id === activeId
            ? "border-cyan-300 bg-cyan-400/10"
            : "border-zinc-800 bg-zinc-900 active:bg-zinc-800/80 hover:border-zinc-700"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setActiveId(chat.id);
            if (isMobile) {
              setIsMobileSidebarOpen(false);
            }
          }}
          className="min-h-11 min-w-0 flex-1 truncate text-left text-sm"
        >
          {chat.title}
        </button>
        <button
          type="button"
          onClick={() => deleteConversation(chat.id)}
          className="min-h-10 min-w-[4.5rem] shrink-0 touch-manipulation rounded-lg px-2 text-xs text-zinc-400 transition active:text-red-400 hover:text-red-400 lg:min-h-0 lg:min-w-0 lg:opacity-0 lg:group-hover:opacity-100"
        >
          Delete
        </button>
      </div>
    ));
  }

  return (
    <div className="flex h-dvh max-h-dvh min-w-0 max-w-[100vw] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-dvh max-h-dvh w-[min(100vw-2.5rem,18rem)] max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-900/98 p-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] shadow-2xl backdrop-blur-md transition-transform duration-200 ease-out will-change-transform lg:hidden ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Assistant</p>
            <h1 className="truncate text-xl font-semibold">corby.ai</h1>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="min-h-10 min-w-10 shrink-0 touch-manipulation rounded-lg border border-zinc-700 text-sm text-zinc-300 active:bg-zinc-800"
            aria-label="Close conversations"
          >
            ✕
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            createConversation();
            setIsMobileSidebarOpen(false);
          }}
          className="mb-3 min-h-11 w-full touch-manipulation rounded-xl bg-cyan-400 px-3 py-2.5 text-sm font-medium text-zinc-950 transition active:bg-cyan-300 hover:bg-cyan-300"
        >
          New conversation
        </button>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          {renderConversationsList(true)}
        </div>
      </aside>

      {mobileOptionsOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 lg:hidden"
            onClick={() => setMobileOptionsOpen(false)}
            aria-hidden
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[70] max-h-[min(85dvh,32rem)] overflow-y-auto rounded-t-2xl border border-zinc-700 border-b-0 bg-zinc-900 shadow-2xl lg:hidden"
            role="dialog"
            aria-labelledby="mobile-options-title"
          >
            <div className="sticky top-0 flex justify-center bg-zinc-900 pb-2 pt-3">
              <div className="h-1 w-10 rounded-full bg-zinc-600" aria-hidden />
            </div>
            <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-1">
              <h3 id="mobile-options-title" className="text-base font-semibold text-zinc-100">
                Chat options
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Extended thinking is slower. Use only if your model supports it.
              </p>
              <button
                type="button"
                onClick={() => setThinkEnabled((v) => !v)}
                aria-pressed={thinkEnabled}
                className={`mt-4 flex min-h-12 w-full touch-manipulation items-center justify-between rounded-xl border px-4 text-sm font-medium ${
                  thinkEnabled
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                    : "border-zinc-700 bg-zinc-950 text-zinc-300"
                }`}
              >
                <span>Thinking mode</span>
                <span className="text-xs opacity-80">{thinkEnabled ? "On" : "Off"}</span>
              </button>
              <p className="mt-6 text-center text-[11px] text-zinc-600">Karacode Labs</p>
              <button
                type="button"
                onClick={() => setMobileOptionsOpen(false)}
                className="mt-3 min-h-12 w-full touch-manipulation rounded-xl bg-zinc-800 py-3 text-sm font-medium text-zinc-100 active:bg-zinc-700"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}

      <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-7xl flex-1 gap-0 px-0 py-0 sm:gap-4 sm:px-[max(0.5rem,env(safe-area-inset-left,0px))] sm:py-2 sm:pr-[max(0.5rem,env(safe-area-inset-right,0px))] sm:pt-[max(0.25rem,env(safe-area-inset-top,0px))] sm:pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] lg:flex-row lg:px-[max(0.5rem,env(safe-area-inset-left,0px))] lg:py-2 lg:pr-[max(0.5rem,env(safe-area-inset-right,0px))]">
        <aside className="hidden min-h-0 w-72 shrink-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 backdrop-blur lg:flex">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">
                Assistant
              </p>
              <h1 className="text-xl font-semibold">corby.ai</h1>
            </div>
            <button
              type="button"
              onClick={createConversation}
              className="rounded-xl bg-cyan-400 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-cyan-300"
            >
              New
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain">
            {renderConversationsList()}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-0 bg-zinc-900/80 backdrop-blur sm:rounded-2xl sm:border sm:border-zinc-800">
          <header className="min-w-0 max-w-full shrink-0 border-b border-zinc-800/80 px-3 py-2 sm:px-5 sm:py-4">
            <div className="flex min-w-0 max-w-full items-center gap-1.5 sm:gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setMobileOptionsOpen(false);
                  setIsMobileSidebarOpen(true);
                }}
                className="flex min-h-10 min-w-10 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-zinc-700 text-zinc-200 active:bg-zinc-800"
                aria-label="Chats"
              >
                <span className="text-lg leading-none">≡</span>
              </button>
              <h2 className="min-w-0 flex-1 truncate text-center text-sm font-semibold tracking-tight text-zinc-100">
                corby.ai
              </h2>
              <button
                type="button"
                onClick={() => setMobileOptionsOpen(true)}
                className="flex min-h-10 min-w-10 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-zinc-700 text-zinc-300 active:bg-zinc-800"
                aria-label="Chat options"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </button>
              <button
                type="button"
                onClick={createConversation}
                className="min-h-10 shrink-0 touch-manipulation rounded-xl bg-cyan-400 px-3 text-sm font-semibold text-zinc-950 active:bg-cyan-300"
              >
                New
              </button>
            </div>
            <div className="mt-2 flex min-w-0 max-w-full gap-1 rounded-xl bg-zinc-950/90 p-1 lg:hidden">
              {CHAT_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={isLoading}
                  onClick={() => setSelectedModel(m.id)}
                  className={`min-h-9 min-w-0 flex-1 touch-manipulation truncate rounded-lg px-1.5 text-center text-[11px] font-medium leading-tight transition disabled:opacity-50 sm:px-2 sm:text-xs ${
                    selectedModel === m.id
                      ? "bg-zinc-800 text-cyan-200 shadow-sm"
                      : "text-zinc-500 active:bg-zinc-800/50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="hidden lg:block">
              <h2 className="text-base font-medium text-zinc-100">Chat with corby.ai</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                Karacode Labs · <span className="text-zinc-300">{selectedModelLabel}</span>
              </p>
              <label htmlFor="model-select" className="mt-3 block text-xs font-medium text-zinc-500">
                Model
              </label>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isLoading}
                className="mt-1.5 h-10 max-w-xs min-h-10 w-full touch-manipulation rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-cyan-300 focus:ring-2 disabled:opacity-50"
              >
                {CHAT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              {selectedModel === VISION_MODEL_ID && (
                <p className="mt-2 text-xs text-zinc-500">
                  Photo analysis with <span className="text-zinc-400">corby 2.0</span>.
                </p>
              )}
            </div>
          </header>

          <div
            ref={messagesScrollRef}
            className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 py-3 [-webkit-overflow-scrolling:touch] sm:space-y-4 sm:p-5"
          >
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700/80 p-4 text-center text-sm text-zinc-500 sm:rounded-2xl sm:p-6 sm:text-left sm:text-base">
                <span className="lg:hidden">Message below to start. Chats save in this browser.</span>
                <span className="hidden lg:inline">
                  Start a conversation — corby.ai will remember it in this browser.
                </span>
              </div>
            ) : (
              activeConversation.messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[min(100%,42rem)] break-words rounded-2xl px-3.5 py-3 text-sm leading-relaxed sm:px-4 ${
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[min(92%,36rem)] bg-cyan-400 text-zinc-950"
                      : "mr-auto w-full max-w-[min(100%,42rem)] bg-zinc-800 text-zinc-100"
                  }`}
                >
                  <p className="mb-1 text-xs uppercase tracking-wider opacity-70">
                    {message.role === "user" ? "You" : "corby.ai"}
                  </p>
                  {message.imageDataUrls && message.imageDataUrls.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {message.imageDataUrls.map((src, idx) => (
                        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded data URLs
                        <img
                          key={`${message.id}-img-${idx}`}
                          src={src}
                          alt="Attached"
                          className="max-h-56 w-full rounded-lg border border-black/10 object-contain sm:max-h-64"
                        />
                      ))}
                    </div>
                  )}
                  {renderMessageContent(message.content, message.id)}
                </div>
              ))
            )}

            {isLoading && (
              <div className="mr-auto max-w-[min(100%,42rem)] rounded-2xl bg-zinc-800 px-3.5 py-3 text-sm text-zinc-300 sm:px-4">
                <p className="mb-1 text-xs uppercase tracking-wider opacity-70">corby.ai</p>
                {streamingReply ? (
                  renderMessageContent(streamingReply, "streaming")
                ) : (
                  <p>
                    {thinkingLabel} ({thinkingSeconds}s)
                  </p>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={sendMessage}
            className="min-w-0 max-w-full shrink-0 border-t border-zinc-800/80 bg-zinc-950/40 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-2 sm:bg-transparent sm:p-4"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={onPickImage}
              aria-label="Upload or capture image for analysis"
            />
            {error && (
              <p className="mb-2 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300" role="alert">
                {error}
              </p>
            )}

            <div className="mb-3 hidden flex-wrap items-center justify-between gap-3 sm:flex">
              <span className="max-w-xl text-xs text-zinc-500">
                Extended thinking is <strong className="text-zinc-400">off</strong> by default (faster). Turn on only for
                models that support <code className="text-zinc-400">think</code>.
              </span>
              <button
                type="button"
                onClick={() => setThinkEnabled((v) => !v)}
                aria-pressed={thinkEnabled}
                className={`min-h-9 shrink-0 rounded-full border px-4 py-2 text-xs font-medium transition ${
                  thinkEnabled
                    ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                    : "border-zinc-600 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                Thinking: {thinkEnabled ? "On" : "Off"}
              </button>
            </div>

            {selectedModel === VISION_MODEL_ID && (
              <div className="mb-2 hidden lg:mb-3 lg:block lg:rounded-xl lg:border lg:border-zinc-700/80 lg:bg-zinc-950/60 lg:p-3">
                {isCompressingPhoto ? (
                  <div className="flex min-h-24 flex-col items-center justify-center gap-2 py-4">
                    <div
                      className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400"
                      aria-hidden
                    />
                    <p className="text-center text-sm text-zinc-400">Optimizing photo…</p>
                    <p className="text-center text-xs text-zinc-500">
                      Large camera files are resized so the page stays fast.
                    </p>
                  </div>
                ) : pendingImageDataUrl ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    {/* eslint-disable-next-line @next/next/no-img-element -- user data URL preview */}
                    <img
                      src={pendingImageDataUrl}
                      alt="Ready to send"
                      className="max-h-36 w-full max-w-xs rounded-lg border border-zinc-600 object-contain"
                    />
                    <div className="flex shrink-0 flex-col gap-2 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoading || isCompressingPhoto}
                        className="min-h-10 touch-manipulation rounded-lg border border-zinc-600 px-3 py-2 text-xs font-medium text-zinc-300 active:bg-zinc-800 disabled:opacity-50"
                      >
                        Change photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingImageDataUrl(null)}
                        disabled={isLoading || isCompressingPhoto}
                        className="min-h-10 touch-manipulation rounded-lg border border-red-500/40 px-3 py-2 text-xs font-medium text-red-300 active:bg-red-950/50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading || isCompressingPhoto}
                      className="flex min-h-11 w-full touch-manipulation items-center justify-center rounded-xl border border-dashed border-cyan-500/40 bg-cyan-500/5 px-4 py-3 text-sm font-medium text-cyan-200/90 active:bg-cyan-500/10 disabled:opacity-50 sm:w-auto sm:px-6"
                    >
                      Add photo to analyze
                    </button>
                    <p className="text-xs text-zinc-500">Camera or gallery — photos are resized automatically.</p>
                  </div>
                )}
              </div>
            )}

            {selectedModel === VISION_MODEL_ID && (
              <div className="mb-2 min-w-0 max-w-full space-y-2 lg:hidden">
                {isCompressingPhoto && (
                  <div className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2">
                    <div
                      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400"
                      aria-hidden
                    />
                    <span className="text-xs text-zinc-400">Optimizing photo…</span>
                  </div>
                )}
                {pendingImageDataUrl && !isCompressingPhoto && (
                  <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/60 py-1.5 pl-1.5 pr-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pendingImageDataUrl}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-md object-cover"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">Ready to send</span>
                    <button
                      type="button"
                      onClick={() => setPendingImageDataUrl(null)}
                      disabled={isLoading}
                      className="shrink-0 touch-manipulation rounded-lg px-2 py-1.5 text-xs font-medium text-red-300 active:bg-red-950/30"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex w-full min-w-0 max-w-full items-center gap-1.5 sm:gap-2">
              {selectedModel === VISION_MODEL_ID && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isCompressingPhoto}
                  className="box-border flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-400 active:bg-zinc-800 disabled:opacity-40 lg:hidden"
                  aria-label="Add photo"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </button>
              )}
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  selectedModel === VISION_MODEL_ID && pendingImageDataUrl
                    ? "Ask about the photo…"
                    : selectedModel === VISION_MODEL_ID
                      ? "Message or attach a photo…"
                      : "Message corby.ai…"
                }
                enterKeyHint="send"
                className="min-h-11 min-w-0 flex-1 basis-0 touch-manipulation rounded-xl border border-zinc-700 bg-zinc-950 px-2.5 py-3 text-base outline-none ring-cyan-300 placeholder:text-zinc-500 focus:ring-2 sm:min-h-10 sm:px-4 sm:text-sm"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="box-border flex h-11 min-w-0 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-red-400/60 bg-red-950/50 px-2.5 text-sm font-semibold text-red-200 active:bg-red-900/60 sm:min-w-[5rem] sm:px-4"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isCompressingPhoto}
                  className="box-border flex h-11 min-w-0 shrink-0 touch-manipulation items-center justify-center rounded-xl bg-cyan-400 px-2.5 text-sm font-semibold text-zinc-950 active:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[5rem] sm:px-4"
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
