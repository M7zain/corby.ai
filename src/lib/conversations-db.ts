import type { RowDataPacket } from "mysql2";
import type { Conversation, ChatMessage } from "@/lib/conversation-types";
import { getMysqlPool } from "@/lib/db";

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 400;
const MAX_TITLE_LEN = 512;
/** MEDIUMTEXT upper bound guard */
const MAX_CONTENT_CHARS = 15 * 1024 * 1024;
const MAX_IMAGE_JSON_CHARS = 14 * 1024 * 1024;
const MAX_ID_LEN = 64;

interface ConvRow extends RowDataPacket {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

interface MsgRow extends RowDataPacket {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  image_urls_json: string | null;
  sort_index: number;
  created_at: Date;
}

function toIso(d: Date | string): string {
  if (d instanceof Date) {
    return d.toISOString();
  }
  return typeof d === "string" ? d : new Date().toISOString();
}

function serializeImageUrlsJson(urls: string[] | undefined | null): string | null {
  if (!urls?.length) {
    return null;
  }
  const full = JSON.stringify(urls);
  if (full.length <= MAX_IMAGE_JSON_CHARS) {
    return full;
  }
  const one = urls[0];
  if (typeof one === "string" && one.length > 0) {
    const budget = MAX_IMAGE_JSON_CHARS - 20;
    return JSON.stringify([one.length > budget ? one.slice(0, budget) : one]);
  }
  return null;
}

function parseImageUrlsJson(json: string | null): string[] | undefined {
  if (!json) {
    return undefined;
  }
  try {
    const a = JSON.parse(json) as unknown;
    if (!Array.isArray(a)) {
      return undefined;
    }
    const out = a.filter((x): x is string => typeof x === "string" && x.length > 0);
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeId(id: string): string | null {
  const s = id.trim().slice(0, MAX_ID_LEN);
  if (!s || !/^[a-zA-Z0-9._-]+$/.test(s)) {
    return null;
  }
  return s;
}

export async function listConversationsForUser(userIdStr: string): Promise<Conversation[] | null> {
  const pool = getMysqlPool();
  if (!pool) {
    return null;
  }
  const userId = Number.parseInt(userIdStr, 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return [];
  }

  try {
    const [convs] = await pool.execute<ConvRow[]>(
      `SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`,
      [userId],
    );
    if (convs.length === 0) {
      return [];
    }
    const ids = convs.map((c) => c.id);
    const placeholders = ids.map(() => "?").join(",");
    const [msgs] = await pool.execute<MsgRow[]>(
      `SELECT id, conversation_id, role, content, image_urls_json, sort_index, created_at
       FROM conversation_messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, sort_index ASC`,
      ids,
    );

    const byConv = new Map<string, ChatMessage[]>();
    for (const m of msgs) {
      const list = byConv.get(m.conversation_id) ?? [];
      const msg: ChatMessage = {
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: toIso(m.created_at),
        ...(() => {
          const imgs = parseImageUrlsJson(m.image_urls_json);
          return imgs ? { imageDataUrls: imgs } : {};
        })(),
      };
      list.push(msg);
      byConv.set(m.conversation_id, list);
    }

    return convs.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: toIso(c.created_at),
      updatedAt: toIso(c.updated_at),
      messages: byConv.get(c.id) ?? [],
    }));
  } catch (err) {
    console.error("[conversations-db] list failed:", err);
    return null;
  }
}

export async function replaceConversationsForUser(
  userIdStr: string,
  conversations: Conversation[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pool = getMysqlPool();
  if (!pool) {
    return { ok: false, error: "Database not configured." };
  }
  const userId = Number.parseInt(userIdStr, 10);
  if (!Number.isFinite(userId) || userId < 1) {
    return { ok: false, error: "Invalid user." };
  }

  if (conversations.length > MAX_CONVERSATIONS) {
    return { ok: false, error: `At most ${MAX_CONVERSATIONS} conversations.` };
  }

  for (const c of conversations) {
    if (!sanitizeId(c.id)) {
      return { ok: false, error: "Invalid conversation id." };
    }
    if (c.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      return { ok: false, error: `At most ${MAX_MESSAGES_PER_CONVERSATION} messages per chat.` };
    }
    for (const m of c.messages) {
      if (!sanitizeId(m.id)) {
        return { ok: false, error: "Invalid message id." };
      }
      if (m.role !== "user" && m.role !== "assistant") {
        return { ok: false, error: "Invalid message role." };
      }
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM conversations WHERE user_id = ?`, [userId]);

    for (const c of conversations) {
      const title = c.title.trim().slice(0, MAX_TITLE_LEN) || "New chat";
      const createdAt = new Date(c.createdAt);
      const updatedAt = new Date(c.updatedAt);
      await conn.execute(
        `INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [sanitizeId(c.id)!, userId, title, createdAt, updatedAt],
      );

      let sortIndex = 0;
      for (const m of c.messages) {
        const content =
          m.content.length > MAX_CONTENT_CHARS ? m.content.slice(0, MAX_CONTENT_CHARS) : m.content;
        const imagesJson = serializeImageUrlsJson(m.imageDataUrls);
        await conn.execute(
          `INSERT INTO conversation_messages (id, conversation_id, role, content, image_urls_json, sort_index, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            sanitizeId(m.id)!,
            sanitizeId(c.id)!,
            m.role,
            content,
            imagesJson,
            sortIndex++,
            new Date(m.createdAt),
          ],
        );
      }
    }

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    console.error("[conversations-db] replace failed:", err);
    return { ok: false, error: "Could not save conversations." };
  } finally {
    conn.release();
  }
}
