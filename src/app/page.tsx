"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamAccumRef = useRef("");

  useEffect(() => {
    window.localStorage.removeItem("corby-ai-think-enabled");
    if (window.localStorage.getItem(THINK_OPT_IN_KEY) === "true") {
      setThinkEnabled(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THINK_OPT_IN_KEY, thinkEnabled ? "true" : "false");
  }, [thinkEnabled]);

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
                <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-2">
                  <span className="text-xs uppercase tracking-wider text-zinc-400">
                    {block.language}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyCode(snippetId, block.value)}
                    className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800"
                  >
                    {copiedSnippetId === snippetId ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-6 text-emerald-300">
                  <code>{block.value}</code>
                </pre>
              </div>
            );
          }

          return (
            <p key={snippetId} className="whitespace-pre-wrap">
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
        className={`group flex items-center justify-between rounded-xl border px-3 py-2 ${
          chat.id === activeId
            ? "border-cyan-300 bg-cyan-400/10"
            : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
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
          className="mr-2 flex-1 truncate text-left text-sm"
        >
          {chat.title}
        </button>
        <button
          type="button"
          onClick={() => deleteConversation(chat.id)}
          className="text-xs text-zinc-400 opacity-100 transition hover:text-red-400 lg:opacity-0 lg:group-hover:opacity-100"
        >
          Delete
        </button>
      </div>
    ));
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 border-r border-zinc-800 bg-zinc-900/95 p-4 backdrop-blur transition-transform duration-200 lg:hidden ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Assistant</p>
            <h1 className="text-xl font-semibold">corby.ai</h1>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            Close
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            createConversation();
            setIsMobileSidebarOpen(false);
          }}
          className="mb-3 w-full rounded-xl bg-cyan-400 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-cyan-300"
        >
          New conversation
        </button>
        <div className="space-y-2 overflow-y-auto">{renderConversationsList(true)}</div>
      </aside>

      <div className="mx-auto flex h-screen max-w-7xl gap-4 p-2 sm:p-4">
        <aside className="hidden w-72 shrink-0 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 backdrop-blur lg:flex lg:flex-col">
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

          <div className="space-y-2 overflow-y-auto">{renderConversationsList()}</div>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur">
          <div className="border-b border-zinc-800 px-4 py-4 sm:px-5">
            <div className="mb-2 flex items-center justify-between lg:hidden">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200"
              >
                Conversations
              </button>
              <button
                type="button"
                onClick={createConversation}
                className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-medium text-zinc-950"
              >
                New
              </button>
            </div>
            <h2 className="text-base font-medium text-zinc-100">Chat with corby.ai</h2>
            <p className="text-sm text-zinc-400">
              Powered by Karacode Labs — model corby
            </p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-5">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-400">
                Start a conversation and corby.ai will remember it.
              </div>
            ) : (
              activeConversation.messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "ml-auto bg-cyan-400 text-zinc-950"
                      : "bg-zinc-800 text-zinc-100"
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
              <div className="max-w-3xl rounded-2xl bg-zinc-800 px-4 py-3 text-sm text-zinc-300">
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

          <form onSubmit={sendMessage} className="border-t border-zinc-800 p-3 sm:p-4">
            {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">
                Extended thinking is <strong className="text-zinc-400">off</strong> by default (faster). Turn on only for
                models that support <code className="text-zinc-400">think</code>.
              </span>
              <button
                type="button"
                onClick={() => setThinkEnabled((v) => !v)}
                aria-pressed={thinkEnabled}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  thinkEnabled
                    ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                    : "border-zinc-600 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                Thinking: {thinkEnabled ? "On" : "Off"}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask corby.ai anything..."
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none ring-cyan-300 placeholder:text-zinc-500 focus:ring-2"
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="shrink-0 rounded-xl border border-red-400/60 bg-red-950/50 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-900/50 sm:px-5"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 sm:px-5"
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
