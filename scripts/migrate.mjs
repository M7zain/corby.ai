/**
 * Creates MySQL tables. Requires DATABASE_URL in environment.
 * Usage: npm run db:migrate
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL?.trim();
if (!url?.toLowerCase().startsWith("mysql")) {
  console.error("DATABASE_URL must be set to a mysql:// connection string.");
  process.exit(1);
}

const useSsl = process.env.MYSQL_SSL !== "0";

const sqlPath = join(__dirname, "..", "sql", "schema.sql");
const sql = readFileSync(sqlPath, "utf8");

const conn = await mysql.createConnection({
  uri: url,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  for (const statement of sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await conn.query(statement);
  }
  console.log("Migration OK: question_events table ready.");
} finally {
  await conn.end();
}
