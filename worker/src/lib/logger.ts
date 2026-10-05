/**
 * Logger estructurado (JSON por línea) con redacción de secretos.
 * Los logs se ven en GitHub Actions y además se guardan como artefacto.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Level = "debug" | "info" | "warn" | "error";

const SECRET_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "INFOJOBS_CLIENT_SECRET",
  "INFOJOBS_CLIENT_ID",
];

// Patrones de tokens conocidos, por si alguno llega en un mensaje de error.
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
  /sb_publishable_[A-Za-z0-9_-]+/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, // JWT
  /Basic\s+[A-Za-z0-9+/=]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/g,
];

export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (value && value.length >= 6) out = out.split(value).join("[REDACTED]");
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out;
}

export class Logger {
  constructor(
    private readonly context: Record<string, unknown> = {},
    private readonly filePath: string | null = null,
  ) {
    if (filePath) mkdirSync(dirname(filePath), { recursive: true });
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra }, this.filePath);
  }

  debug(msg: string, data?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === "debug") this.write("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>) {
    this.write("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>) {
    this.write("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>) {
    this.write("error", msg, data);
  }

  private write(level: Level, msg: string, data?: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), level, msg, ...this.context, ...data };
    const line = redact(JSON.stringify(entry, errorReplacer));
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
    if (this.filePath) appendFileSync(this.filePath, line + "\n", "utf8");
  }
}

function errorReplacer(_key: string, value: unknown) {
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

export function errorMessage(err: unknown): string {
  return redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}
