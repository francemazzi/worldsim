export interface Message {
  id: string;
  from: string;
  to: string | "*";
  type: "speak" | "warn" | "block" | "observe" | "system";
  content: string;
  tick: number;
  metadata?: Record<string, unknown>;
}
