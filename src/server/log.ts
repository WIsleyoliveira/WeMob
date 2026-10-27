/** Logger estruturado (JSON em stdout) com remoção de campos sensíveis. */
const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|card|cvv|apikey|api_key/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? "[redacted]" : redact(x, depth + 1)]));
}

type Level = "debug" | "info" | "warn" | "error";
function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...(redact(data) as object) });
  (level === "error" ? console.error : console.log)(line);
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
export const __test = { redact };
