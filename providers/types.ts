export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ChatEvent =
  | { type: "pending"; label: string; detail: string }
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
  readonly id: string;
  readonly model: string;
  readonly vendor: string;
  readonly supportsSystem: boolean;
  send(text: string, handlers?: SendHandlers): Promise<ChatResult>;
  reset(): void;
  history(): readonly ChatMessage[];
  info(): Array<[string, string]>;
  setSystem?(prompt: string | undefined): void;
}
