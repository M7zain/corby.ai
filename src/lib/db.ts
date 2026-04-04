import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

/**
 * Shared pool when `DATABASE_URL` is a `mysql://…` connection string.
 * SSL relaxed by default for shared hosts (Hostinger, etc.); set `MYSQL_SSL=0` to disable.
 */
export function getMysqlPool(): mysql.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url?.toLowerCase().startsWith("mysql")) {
    return null;
  }
  if (!pool) {
    const useSsl = process.env.MYSQL_SSL !== "0";
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || 10),
      maxIdle: 8,
      idleTimeout: 60000,
      enableKeepAlive: true,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return pool;
}
