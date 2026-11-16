import type { ChatProvider } from "../providers/types.js";
import { GeminiProvider } from "../providers/gemini/gemini.js";
import { GptProvider } from "../providers/gpt/gpt.js";

export interface ModelEntry {
  id: string;
  short: string;
  label: string;
  vendor: string;
  create: () => ChatProvider;
}

export const MODELS: ModelEntry[] = [
  {
    id: "gemini",
    short: "gemini 3.5",
    label: "gemini 3.5 flash lite",
    vendor: "google",
    create: () => new GeminiProvider(),
  },
  {
    id: "gpt",
    short: "gpt-6",
    label: "gpt-6",
    vendor: "openai",
    create: () => new GptProvider(),
  },
];

export const DEFAULT_MODEL = "gemini";
