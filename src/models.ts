import type { ChatProvider } from "../providers/types.js";
import { GeminiProvider } from "../providers/gemini/gemini.js";
import { GptProvider } from "../providers/gpt/gpt.js";

export interface ModelEntry {
  id: string;
  short: string;
  label: string;
  provider: string;
  create: () => ChatProvider;
}

export const MODELS: ModelEntry[] = [
  {
    id: "gemini",
    short: "gemini 3.5",
    label: "gemini 3.5 flash lite",
    provider: "google",
    create: () => new GeminiProvider(),
  },
  {
    id: "gpt",
    short: "gpt-6",
    label: "gpt-6",
    provider: "openai",
    create: () => new GptProvider(),
  },
];

export const DEFAULT_MODEL = "gemini";
