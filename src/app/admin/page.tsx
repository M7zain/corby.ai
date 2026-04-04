"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";

type ClientRow = {
  clientId: string;
  userEmail: string | null;
  userName: string | null;
  questionCount: number;
  lastAt: string;
  lastQuestionPreview: string;
  lastModel: string;
};

type RecentRow = {
  at: string;
  clientId: string;
  userEmail: string | null;
  userName: string | null;
  model: string;
  preview: string;
  hasImage: boolean;
  imageCount?: number;
  imagesDataUrls?: string[];
};

type Overview = {
  totalQuestions: number;
  uniqueClients: number;
  clients: ClientRow[];
  recent: RecentRow[];
};

export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  const loadOverview = useCallback(async (silent?: boolean) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const res = await fetch("/api/admin/overview", { credentials: "include" });
      if (res.status === 401) {
        setOverview(null);
        setLoginError("Sign in as an admin user to view this page.");
        return;
      }
      if (res.status === 403) {
        setOverview(null);
        setLoginError("Your account does not have admin access.");
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
    if (status === "authenticated" && session?.user?.role === "admin") {
      void loadOverview(true);
    }
    if (status === "unauthenticated") {
      setOverview(null);
    }
  }, [status, session?.user?.role, loadOverview]);

  async function onLogout() {
    await signOut({ callbackUrl: "/login" });
    setOverview(null);
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-400">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-dvh bg-zinc-950 px-4 py-12 text-zinc-100">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-3 text-sm text-zinc-500">Sign in with an admin account to view question activity.</p>
          <Link
            href="/login?callbackUrl=/admin"
            className="mt-8 inline-block rounded-xl bg-cyan-400 px-6 py-3 text-sm font-semibold text-zinc-950"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (session?.user?.role !== "admin") {
    return (
      <div className="min-h-dvh bg-zinc-950 px-4 py-12 text-zinc-100">
        <div className="mx-auto max-w-md text-center">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-3 text-sm text-zinc-500">This area is only for administrators.</p>
          <Link href="/" className="mt-8 inline-block text-sm text-cyan-300 hover:underline">
            Back to chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 px-4 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Admin · question activity</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Each row is one question sent to the model (name and email are stored when the message was sent). Full chat
          transcripts are not logged.
        </p>

        {!overview && (
          <div className="mt-8 max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6">
            {loginError && <p className="text-sm text-red-400">{loginError}</p>}
            {!loginError && <p className="text-sm text-zinc-500">Loading dashboard…</p>}
            <button
              type="button"
              onClick={() => loadOverview()}
              disabled={loading}
              className="w-full rounded-xl border border-zinc-600 py-3 text-sm text-zinc-300 disabled:opacity-50"
            >
              {loading ? "…" : "Retry"}
            </button>
          </div>
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
                  onClick={() => void onLogout()}
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
                      <th className="px-4 py-3">Who</th>
                      <th className="px-4 py-3">Questions</th>
                      <th className="px-4 py-3">Last model</th>
                      <th className="px-4 py-3">Last activity</th>
                      <th className="px-4 py-3">Last question</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {overview.clients.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                          No questions logged yet.
                        </td>
                      </tr>
                    ) : (
                      overview.clients.map((c) => (
                        <tr key={c.clientId} className="bg-zinc-950/40">
                          <td className="max-w-[220px] px-4 py-3 text-sm text-zinc-200">
                            <div className="font-medium text-zinc-100">
                              {c.userName?.trim() || c.userEmail || "—"}
                            </div>
                            {c.userName?.trim() && c.userEmail && (
                              <div className="mt-0.5 truncate text-xs text-zinc-500" title={c.userEmail}>
                                {c.userEmail}
                              </div>
                            )}
                            <div className="mt-1 font-mono text-[10px] text-zinc-600" title="User id at log time">
                              id {c.clientId}
                            </div>
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
                          <div className="min-w-0 text-xs text-zinc-400">
                            <span className="font-medium text-zinc-200">
                              {r.userName?.trim() || r.userEmail || "—"}
                            </span>
                            {r.userName?.trim() && r.userEmail && (
                              <span className="block truncate text-zinc-500">{r.userEmail}</span>
                            )}
                            <span className="mt-0.5 block font-mono text-[10px] text-zinc-600">
                              id {r.clientId}
                            </span>
                          </div>
                          <time className="shrink-0 text-xs text-zinc-600">{new Date(r.at).toLocaleString()}</time>
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
