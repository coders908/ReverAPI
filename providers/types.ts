export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** real stages reported by a provider while a request is in flight */
export type ChatEvent =
  /** update the in-place "working" line */
  | { type: "pending"; label: string; detail: string }
  /** a finished stage, printed as a permanent line */
  | { type: "stage"; label: string; detail: string }
  | { type: "first-byte"; ms: number }
  | { type: "done"; chunks?: number; bytes?: number; ms: number; note?: string };

export interface SendHandlers {
  onDelta?: (delta: string) => void;
  onEvent?: (event: ChatEvent) => void;
}

export interface ChatResult {
  text: string;
  chunks: number;
  bytes: number;
}

export interface ChatProvider {
  /** registry id, e.g. "gemini" */
  readonly id: string;
  /** display name, e.g. "gemini 3.5 flash lite" */
  readonly model: string;
  /** vendor, e.g. "google" */
  readonly vendor: string;
  readonly supportsSystem: boolean;
  send(text: string, handlers?: SendHandlers): Promise<ChatResult>;
  reset(): void;
  history(): readonly ChatMessage[];
  info(): Array<[string, string]>;
  setSystem?(prompt: string | undefined): void;
}
