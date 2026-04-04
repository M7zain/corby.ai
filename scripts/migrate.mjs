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
  try {
    await conn.query(
      "ALTER TABLE question_events ADD COLUMN images_base64_json LONGTEXT NULL",
    );
    console.log("Added column images_base64_json.");
  } catch (e) {
    if (e?.code !== "ER_DUP_FIELDNAME") {
      throw e;
    }
  }
  try {
    await conn.query(
      "ALTER TABLE question_events ADD COLUMN user_email VARCHAR(255) NULL",
    );
    console.log("Added column user_email.");
  } catch (e) {
    if (e?.code !== "ER_DUP_FIELDNAME") {
      throw e;
    }
  }
  try {
    await conn.query(
      "ALTER TABLE question_events ADD COLUMN user_name VARCHAR(191) NULL",
    );
    console.log("Added column user_name.");
  } catch (e) {
    if (e?.code !== "ER_DUP_FIELDNAME") {
      throw e;
    }
  }
  try {
    await conn.query(
      "CREATE INDEX idx_question_events_user_email ON question_events (user_email)",
    );
    console.log("Added index idx_question_events_user_email.");
  } catch (e) {
    if (e?.code !== "ER_DUP_KEYNAME") {
      throw e;
    }
  }
  console.log("Migration OK: question_events + users ready.");
} finally {
  await conn.end();
}
