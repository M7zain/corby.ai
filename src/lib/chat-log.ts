import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { getMysqlPool } from "@/lib/db";

export type QuestionLogEvent = {
  at: string;
  clientId: string;
  model: string;
  question: string;
  hasImage: boolean;
  /** JSON array of raw base64 strings (Ollama format), when stored */
  imagesBase64Json?: string | null;
};

interface QuestionRow extends RowDataPacket {
  client_id: string;
  model: string;
  question: string;
  has_image: number;
  images_base64_json: string | null;
  created_at: Date | string;
}

const dataDir = path.join(process.cwd(), "data");
const logFile = path.join(dataDir, "user-questions.jsonl");

/** ~4.5 MiB decoded per image cap; total payload cap for LONGTEXT safety */
const MAX_BASE64_CHARS_PER_IMAGE = 6 * 1024 * 1024;
const MAX_TOTAL_JSON_CHARS = 14 * 1024 * 1024;

export function serializeImagesBase64Json(images: string[] | undefined | null): string | null {
  if (!images?.length) {
    return null;
  }
  const trimmed = images.map((s) =>
    s.length > MAX_BASE64_CHARS_PER_IMAGE ? s.slice(0, MAX_BASE64_CHARS_PER_IMAGE) : s,
  );
  let json = JSON.stringify(trimmed);
  if (json.length <= MAX_TOTAL_JSON_CHARS) {
    return json;
  }
  if (trimmed[0]) {
    let one = trimmed[0];
    const budget = MAX_TOTAL_JSON_CHARS - 20;
    if (one.length > budget) {
      one = one.slice(0, budget);
    }
    json = JSON.stringify([one]);
  }
  return json;
}

export function countImagesInStoredJson(json: string | null | undefined): number {
  if (!json) {
    return 0;
  }
  try {
    const a = JSON.parse(json) as unknown;
    return Array.isArray(a) ? a.length : 0;
  } catch {
    return 0;
  }
}

function rowToEvent(r: QuestionRow): QuestionLogEvent {
  const at =
    r.created_at instanceof Date
      ? r.created_at.toISOString()
      : typeof r.created_at === "string"
        ? r.created_at
        : String(r.created_at);
  return {
    at,
    clientId: r.client_id,
    model: r.model,
    question: r.question,
    hasImage: Boolean(r.has_image),
    imagesBase64Json: r.images_base64_json ?? null,
  };
}

export async function logUserQuestion(entry: {
  clientId: string;
  model: string;
  question: string;
  hasImage: boolean;
  imagesBase64?: string[] | null;
}): Promise<void> {
  const imagesJson = serializeImagesBase64Json(entry.imagesBase64 ?? null);

  const pool = getMysqlPool();
  if (pool) {
    try {
      await pool.execute(
        `INSERT INTO question_events (client_id, model, question, has_image, images_base64_json) VALUES (?, ?, ?, ?, ?)`,
        [
          entry.clientId.slice(0, 128),
          entry.model.slice(0, 64),
          entry.question.slice(0, 8000),
          entry.hasImage ? 1 : 0,
          imagesJson,
        ],
      );
    } catch (err) {
      console.error("[chat-log] MySQL write failed:", err);
    }
    return;
  }

  try {
    await mkdir(dataDir, { recursive: true });
    const line: QuestionLogEvent = {
      at: new Date().toISOString(),
      clientId: entry.clientId.slice(0, 128),
      model: entry.model.slice(0, 64),
      question: entry.question.slice(0, 8000),
      hasImage: entry.hasImage,
      imagesBase64Json: imagesJson,
    };
    await appendFile(logFile, `${JSON.stringify(line)}\n`, "utf8");
  } catch (err) {
    console.error("[chat-log] file write failed:", err);
  }
}

export async function readAllQuestionEvents(): Promise<QuestionLogEvent[]> {
  const pool = getMysqlPool();
  if (pool) {
    try {
      const [rows] = await pool.execute<QuestionRow[]>(
        `SELECT client_id, model, question, has_image, images_base64_json, created_at
         FROM question_events
         ORDER BY created_at ASC`,
      );
      return rows.map(rowToEvent);
    } catch (err) {
      console.error("[chat-log] MySQL read failed:", err);
      return [];
    }
  }

  try {
    const raw = await readFile(logFile, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as QuestionLogEvent);
  } catch {
    return [];
  }
}

export type ClientSummary = {
  clientId: string;
  questionCount: number;
  lastAt: string;
  lastQuestionPreview: string;
  lastModel: string;
};

export function summarizeByClient(events: QuestionLogEvent[]): ClientSummary[] {
  const map = new Map<
    string,
    { questionCount: number; lastAt: string; lastQuestion: string; lastModel: string }
  >();

  for (const e of events) {
    const prev = map.get(e.clientId);
    if (!prev) {
      map.set(e.clientId, {
        questionCount: 1,
        lastAt: e.at,
        lastQuestion: e.question,
        lastModel: e.model,
      });
      continue;
    }
    prev.questionCount += 1;
    if (e.at >= prev.lastAt) {
      prev.lastAt = e.at;
      prev.lastQuestion = e.question;
      prev.lastModel = e.model;
    }
  }

  return [...map.entries()]
    .map(([clientId, v]) => ({
      clientId,
      questionCount: v.questionCount,
      lastAt: v.lastAt,
      lastQuestionPreview: v.lastQuestion.length > 120 ? `${v.lastQuestion.slice(0, 120)}…` : v.lastQuestion,
      lastModel: v.lastModel,
    }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}
