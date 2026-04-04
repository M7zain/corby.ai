"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";

function publicAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Internal paths only, or same-origin absolute URLs (avoids open redirects). */
function safeCallbackUrl(raw: string | null): string {
  const fallback = "/";
  if (!raw?.trim()) {
    return fallback;
  }
  const s = raw.trim();
  if (s.startsWith("/") && !s.startsWith("//")) {
    return s;
  }
  try {
    const u = new URL(s);
    const path = `${u.pathname}${u.search}${u.hash}` || fallback;
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      return path;
    }
    const configured = publicAppOrigin();
    if (configured && u.origin === configured) {
      return path;
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      return path;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callbackUrl = safeCallbackUrl(searchParams.get("callbackUrl"));

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid email or password.");
        return;
      }
      router.replace(callbackUrl);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-zinc-400" aria-busy>
        Loading…
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-zinc-500">Use the account you registered with.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-400">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="mt-1.5 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none ring-cyan-400/50 focus:ring-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-400">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="mt-1.5 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none ring-cyan-400/50 focus:ring-2"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-cyan-400 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50"
        >
          {loading ? "…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        No account?{" "}
        <Link href="/register" className="text-cyan-300 hover:underline">
          Register
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-zinc-950 px-4 py-12 text-zinc-100">
      <div className="mx-auto max-w-md">
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center text-zinc-400" aria-busy>
              Loading…
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
