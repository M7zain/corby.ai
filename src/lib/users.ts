import bcrypt from "bcryptjs";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { getMysqlPool } from "@/lib/db";

const SALT_ROUNDS = 12;

export type DbUser = {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  role: "user" | "admin";
};

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
  role: "user" | "admin";
}

interface UserEmailNameRow extends RowDataPacket {
  email: string;
  name: string | null;
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  const pool = getMysqlPool();
  if (!pool) {
    return null;
  }
  const norm = email.trim().toLowerCase();
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT id, email, name, password_hash, role FROM users WHERE email = ? LIMIT 1",
    [norm],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  return {
    id: String(r.id),
    email: r.email,
    name: r.name,
    password_hash: r.password_hash,
    role: r.role,
  };
}

/** For logging / admin when the session JWT predates email+name on the token. */
export async function getUserById(id: string): Promise<{ email: string; name: string | null } | null> {
  const pool = getMysqlPool();
  if (!pool) {
    return null;
  }
  const n = Number.parseInt(id, 10);
  if (!Number.isFinite(n) || n < 1) {
    return null;
  }
  const [rows] = await pool.execute<UserEmailNameRow[]>(
    "SELECT email, name FROM users WHERE id = ? LIMIT 1",
    [n],
  );
  const r = rows[0];
  if (!r) {
    return null;
  }
  return { email: r.email, name: r.name };
}

function adminEmailsFromEnv(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function createUser(params: {
  email: string;
  name: string;
  password: string;
}): Promise<{ id: string }> {
  const pool = getMysqlPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim().slice(0, 191);
  const adminSet = adminEmailsFromEnv();
  const role: "user" | "admin" = adminSet.has(email) ? "admin" : "user";
  const password_hash = await bcrypt.hash(params.password, SALT_ROUNDS);
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, name || null, password_hash, role],
  );
  return { id: String(result.insertId) };
}
