"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ClientRow = {
  clientId: string;
  questionCount: number;
  lastAt: string;
  lastQuestionPreview: string;
  lastModel: string;
};

type RecentRow = {
  at: string;
  clientId: string;
  model: string;
  preview: string;
  hasImage: boolean;
  imageCount?: number;
  /** Data URLs for thumbnails (admin-only). */
  imagesDataUrls?: string[];
};

type Overview = {
  totalQuestions: number;
  uniqueClients: number;
  clients: ClientRow[];
  recent: RecentRow[];
};

export default function AdminDashboardPage() {
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadOverview = useCallback(async (silent?: boolean) => {
    if (!silent) {
      setLoading(true);
    }
    setUnauthorized(false);
    try {
      const res = await fetch("/api/admin/overview", { credentials: "include" });
      if (res.status === 401) {
        setOverview(null);
        setUnauthorized(true);
        if (silent) {
          setLoginError(null);
        }
        return;
      }
      if (res.status === 503) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setOverview(null);
        setLoginError(j?.error || "Admin is not configured on the server.");
        return;
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || res.statusText);
      }
      setLoginError(null);
      setOverview((await res.json()) as Overview);
    } catch (e) {
      setOverview(null);
      setLoginError(e instanceof Error ? e.message : "Could not load dashboard");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadOverview(true);
  }, [loadOverview]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || "Login failed");
      }
      setPassword("");
      await loadOverview();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setOverview(null);
    setUnauthorized(true);
  }

  return (
    <div className="min-h-dvh bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Admin · question activity</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Each browser gets an anonymous ID. Questions are logged when users send a message (not stored chat history).
        </p>

        {!overview && (
          <form
            onSubmit={onLogin}
            className="mt-8 max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6"
          >
            <label className="block text-sm font-medium text-zinc-400">Admin password</label>
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none ring-cyan-400/50 focus:ring-2"
              placeholder="Set ADMIN_PASSWORD on the server"
            />
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            {unauthorized && !loginError && (
              <p className="text-sm text-zinc-500">Sign in to view the dashboard.</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full rounded-xl bg-cyan-400 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50"
            >
              {loading ? "…" : "Sign in"}
            </button>
          </form>
        )}

        {overview && (
          <div className="mt-8 space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-6 text-sm">
                <div>
                  <p className="text-zinc-500">Questions logged</p>
                  <p className="text-2xl font-semibold text-cyan-200">{overview.totalQuestions}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Distinct clients</p>
                  <p className="text-2xl font-semibold text-cyan-200">{overview.uniqueClients}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => loadOverview()}
                  disabled={loading}
                  className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-300"
                >
                  Sign out
                </button>
              </div>
            </div>

            <section>
              <h2 className="mb-3 text-lg font-medium text-zinc-200">By client</h2>
              <div className="overflow-x-auto rounded-xl border border-zinc-800">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-3">Client ID</th>
                      <th className="px-4 py-3">Questions</th>
                      <th className="px-4 py-3">Last model</th>
                      <th className="px-4 py-3">Last seen</th>
                      <th className="px-4 py-3">Last question</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {overview.clients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                          No questions logged yet. Send a chat from the app first.
                        </td>
                      </tr>
                    ) : (
                      overview.clients.map((c) => (
                        <tr key={c.clientId} className="bg-zinc-950/40">
                          <td className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-zinc-400">
                            {c.clientId}
                          </td>
                          <td className="px-4 py-3">{c.questionCount}</td>
                          <td className="px-4 py-3 text-zinc-400">{c.lastModel}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                            {new Date(c.lastAt).toLocaleString()}
                          </td>
                          <td className="max-w-md px-4 py-3 text-zinc-300">{c.lastQuestionPreview}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-medium text-zinc-200">Recent questions</h2>
              <ul className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                {overview.recent.length === 0 ? (
                  <li className="text-zinc-500">No entries yet.</li>
                ) : (
                  overview.recent.map((r, i) => {
                    const imageDisplayCount =
                      (r.imagesDataUrls?.length ?? 0) > 0
                        ? r.imagesDataUrls!.length
                        : r.hasImage
                          ? (r.imageCount ?? 1)
                          : 0;
                    return (
                    <li
                      key={`${r.at}-${r.clientId}-${i}`}
                      className="border-b border-zinc-800/60 pb-3 text-sm last:border-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-mono text-xs text-zinc-500">{r.clientId}</span>
                        <time className="text-xs text-zinc-600">{new Date(r.at).toLocaleString()}</time>
                      </div>
                      <p className="mt-1 text-zinc-300">{r.preview}</p>
                      <p className="mt-1 text-xs text-zinc-600">
                        {r.model}
                        {imageDisplayCount > 0
                          ? ` · ${imageDisplayCount} image${imageDisplayCount === 1 ? "" : "s"}`
                          : ""}
                      </p>
                      {(r.imagesDataUrls?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.imagesDataUrls!.map((src, j) => (
                            <a
                              key={j}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block shrink-0 rounded-lg border border-zinc-700 bg-zinc-900/60 ring-cyan-400/30 transition hover:ring-2"
                            >
                              <img
                                src={src}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="max-h-40 max-w-[min(100%,280px)] rounded-lg object-contain"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                    );
                  })
                )}
              </ul>
            </section>

            <p className="text-xs text-zinc-600">
              With <code className="text-zinc-500">DATABASE_URL</code>, rows go to MySQL table{" "}
              <code className="text-zinc-500">question_events</code>. Without it, logs use{" "}
              <code className="text-zinc-500">data/user-questions.jsonl</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
