import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "corby_admin";

export function adminSessionToken(adminPassword: string): string {
  return createHmac("sha256", adminPassword).update("corby-admin-session").digest("hex");
}

export function verifyAdminSessionCookie(cookieValue: string | undefined, adminPassword: string | undefined): boolean {
  if (!adminPassword || !cookieValue) {
    return false;
  }
  const expected = adminSessionToken(adminPassword);
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(cookieValue, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
