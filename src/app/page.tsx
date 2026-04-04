"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CHAT_MODELS } from "@/lib/chat-models";

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !activeConversation || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const updatedMessages = [...activeConversation.messages, userMessage];
    const chatTitle =
      activeConversation.title === "New chat"
        ? shortTitleFromMessage(text)
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
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          think: thinkEnabled,
          model: selectedModel,
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
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
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

      <div className="mx-auto flex min-h-0 flex-1 max-w-7xl gap-2 px-[max(0.5rem,env(safe-area-inset-left,0px))] py-2 pr-[max(0.5rem,env(safe-area-inset-right,0px))] pt-[max(0.25rem,env(safe-area-inset-top,0px))] pb-[max(0.25rem,env(safe-area-inset-bottom,0px))] sm:gap-4 sm:p-4 lg:flex-row">
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur sm:rounded-2xl">
          <header className="shrink-0 border-b border-zinc-800 px-3 py-3 sm:px-5 sm:py-4">
            <div className="mb-2 flex items-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="min-h-11 min-w-11 shrink-0 touch-manipulation rounded-xl border border-zinc-700 px-3 text-sm text-zinc-200 active:bg-zinc-800"
                aria-label="Open conversations"
              >
                ☰
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-medium text-zinc-100">corby.ai</h2>
              </div>
              <button
                type="button"
                onClick={createConversation}
                className="min-h-11 shrink-0 touch-manipulation rounded-xl bg-cyan-400 px-4 text-sm font-medium text-zinc-950 active:bg-cyan-300"
              >
                New
              </button>
            </div>
            <h2 className="hidden text-base font-medium text-zinc-100 lg:block">Chat with corby.ai</h2>
            <p className="mt-0.5 text-xs leading-snug text-zinc-400 sm:text-sm">
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
              className="mt-1.5 h-11 w-full min-h-11 touch-manipulation rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-base text-zinc-100 outline-none ring-cyan-300 focus:ring-2 disabled:opacity-50 sm:h-10 sm:max-w-xs sm:min-h-10 sm:text-sm"
            >
              {CHAT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </header>

          <div
            ref={messagesScrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain p-3 [-webkit-overflow-scrolling:touch] sm:space-y-4 sm:p-5"
          >
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 p-5 text-sm leading-relaxed text-zinc-400 sm:p-6">
                Start a conversation — corby.ai will remember it in this browser.
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
            className="shrink-0 border-t border-zinc-800 bg-zinc-900/90 p-3 sm:bg-transparent sm:p-4"
          >
            {error && (
              <p className="mb-2 rounded-lg bg-red-950/40 px-3 py-2 text-sm text-red-300" role="alert">
                {error}
              </p>
            )}
            <details className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950/50 sm:hidden">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-zinc-400 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-2">
                  Advanced · thinking
                  <span className="text-xs text-zinc-500">{thinkEnabled ? "On" : "Off"}</span>
                </span>
              </summary>
              <div className="border-t border-zinc-800 px-3 py-3">
                <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                  Slower on some models. Only enable if your model supports <code className="text-zinc-400">think</code>.
                </p>
                <button
                  type="button"
                  onClick={() => setThinkEnabled((v) => !v)}
                  aria-pressed={thinkEnabled}
                  className={`min-h-11 w-full touch-manipulation rounded-xl border px-4 text-sm font-medium transition active:opacity-90 ${
                    thinkEnabled
                      ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                      : "border-zinc-600 bg-zinc-900 text-zinc-300"
                  }`}
                >
                  Thinking: {thinkEnabled ? "On" : "Off"}
                </button>
              </div>
            </details>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Message corby.ai…"
                enterKeyHint="send"
                className="min-h-11 w-full flex-1 touch-manipulation rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base outline-none ring-cyan-300 placeholder:text-zinc-500 focus:ring-2 sm:min-h-10 sm:text-sm"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="min-h-11 w-full touch-manipulation rounded-xl border border-red-400/60 bg-red-950/50 px-4 text-sm font-semibold text-red-200 transition active:bg-red-900/60 sm:min-w-[5.5rem] sm:w-auto"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="min-h-11 w-full touch-manipulation rounded-xl bg-cyan-400 px-4 text-sm font-semibold text-zinc-950 transition active:bg-cyan-300 sm:min-w-[5.5rem] sm:w-auto"
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
