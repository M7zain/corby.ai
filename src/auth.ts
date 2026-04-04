import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

/** DB + bcrypt load only here (dynamic import) so middleware stays Edge-safe — no mysql2/stream in the bundle. */
async function authorizeWithDb(
  email: string,
  password: string,
): Promise<{ id: string; email: string; name: string | null; role: "user" | "admin" } | null> {
  const [{ getUserByEmail }, bcrypt] = await Promise.all([
    import("@/lib/users"),
    import("bcryptjs"),
  ]);
  const user = await getUserByEmail(email);
  if (!user) {
    return null;
  }
  const ok = await bcrypt.default.compare(password, user.password_hash);
  if (!ok) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

declare module "next-auth" {
  interface User {
    role: "user" | "admin";
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: "user" | "admin";
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: "user" | "admin";
  }
}

function authSecret(): string {
  const fromEnv = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (fromEnv?.trim()) {
    return fromEnv.trim();
  }
  if (process.env.NODE_ENV === "development") {
    return "dev-only-insecure-secret-set-AUTH_SECRET-in-env-for-production";
  }
  throw new Error("AUTH_SECRET (or NEXTAUTH_SECRET) must be set in production.");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret(),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) {
          return null;
        }
        return authorizeWithDb(email, password);
      },
    }),
  ],
  callbacks: {
    /**
     * Do not use `authorized` here: Next.js middleware runs on Edge, and session/JWT handling
     * can disagree with Node (where `/api/auth` and route handlers run), causing endless redirects
     * to `/login?callbackUrl=...` for `/admin` even when the browser session is valid.
     * Enforce access in route handlers (`/api/chat`, `/api/admin/*`) and the admin page UI instead.
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role;
        token.email = user.email;
        token.name = user.name ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = (token.role as "user" | "admin") ?? "user";
        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
        if (token.name !== undefined) {
          session.user.name = token.name as string | null;
        }
      }
      return session;
    },
  },
});
