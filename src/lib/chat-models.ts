/** Ollama tag for the vision-capable model (UI label: corby 2.0). */
export const VISION_MODEL_ID = "gemma4:latest";

export const CHAT_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "corby:latest", label: "Corby" },
  { id: VISION_MODEL_ID, label: "corby 2.0" },
];

export const ALLOWED_CHAT_MODEL_IDS = new Set(CHAT_MODELS.map((m) => m.id));
