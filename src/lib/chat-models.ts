export const CHAT_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "corby:latest", label: "Corby" },
  { id: "gemma4:latest", label: "Gemma 4" },
];

export const ALLOWED_CHAT_MODEL_IDS = new Set(CHAT_MODELS.map((m) => m.id));
