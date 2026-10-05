/**
 * Lee el archivo de ejecución que deja claude-code-action (output
 * `execution_file`: lista de mensajes de Claude Code). De ahí se obtiene:
 *   - la salida estructurada (structured_output del mensaje "result");
 *   - el consumo (tokens, turnos, duración) y avisos de límite de uso.
 * Nunca se lee nada de credenciales: el archivo no las contiene.
 */
import { existsSync, readFileSync } from "node:fs";
import { ClaudeAnalysisSchema, ClaudeOutputSchema, type ClaudeAnalysis } from "./analysisSchema.js";

export interface ExecutionSummary {
  found: boolean;
  status: "ok" | "usage_limit" | "failed" | "invalid_output" | "missing";
  analyses: ClaudeAnalysis[];
  invalid_items: number;
  error: string | null;
  usage: {
    model: string | null;
    num_turns: number | null;
    duration_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
    /** Coste equivalente que calcula Claude Code. Con suscripción NO se factura: es solo orientativo. */
    equivalent_api_cost_usd: number | null;
    permission_denials: number | null;
    rate_limit_events: Record<string, unknown>[];
  } | null;
}

const USAGE_LIMIT_RE = /usage limit|rate limit|limit reached|out of (?:extra )?usage|quota|429|overloaded/i;

type Msg = Record<string, unknown>;

export function readExecutionFile(path: string | null | undefined): ExecutionSummary {
  if (!path || !existsSync(path)) {
    return { found: false, status: "missing", analyses: [], invalid_items: 0, error: "No hay archivo de ejecución de Claude", usage: null };
  }
  let messages: Msg[];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    messages = Array.isArray(parsed) ? (parsed as Msg[]) : [];
  } catch {
    return { found: true, status: "failed", analyses: [], invalid_items: 0, error: "Archivo de ejecución ilegible", usage: null };
  }
  return summarizeExecution(messages);
}

export function summarizeExecution(messages: Msg[]): ExecutionSummary {
  const result = [...messages].reverse().find((m) => m.type === "result");
  const init = messages.find((m) => m.type === "system" && m.subtype === "init");
  const rateLimitEvents = messages
    .filter((m) => typeof m.type === "string" && /rate_limit/i.test(m.type as string))
    .map((m) => pickScalars(m));

  const usageRaw = (result?.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const usage: NonNullable<ExecutionSummary["usage"]> = {
    model: typeof init?.model === "string" ? (init.model as string) : modelFrom(result),
    num_turns: num(result?.num_turns),
    duration_ms: num(result?.duration_ms),
    input_tokens: num(usageRaw.input_tokens),
    output_tokens: num(usageRaw.output_tokens),
    cache_read_input_tokens: num(usageRaw.cache_read_input_tokens),
    cache_creation_input_tokens: num(usageRaw.cache_creation_input_tokens),
    equivalent_api_cost_usd: num(result?.total_cost_usd),
    permission_denials: Array.isArray(result?.permission_denials) ? (result!.permission_denials as unknown[]).length : null,
    rate_limit_events: rateLimitEvents,
  };

  if (!result) {
    const text = JSON.stringify(messages.slice(-3));
    return {
      found: true,
      status: USAGE_LIMIT_RE.test(text) ? "usage_limit" : "failed",
      analyses: [],
      invalid_items: 0,
      error: "Claude no terminó (sin mensaje de resultado)",
      usage,
    };
  }

  const isError = result.is_error === true || result.subtype !== "success";
  if (isError) {
    const detail = [result.subtype, ...(Array.isArray(result.errors) ? (result.errors as string[]) : []), typeof result.result === "string" ? result.result : ""]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300);
    return {
      found: true,
      status: USAGE_LIMIT_RE.test(detail) ? "usage_limit" : "failed",
      analyses: [],
      invalid_items: 0,
      error: `Claude terminó con error: ${detail || "desconocido"}`,
      usage,
    };
  }

  const { analyses, invalid } = validateOutput(result.structured_output);
  if (!analyses.length) {
    return { found: true, status: "invalid_output", analyses: [], invalid_items: invalid, error: "Salida estructurada ausente o inválida", usage };
  }
  return { found: true, status: "ok", analyses, invalid_items: invalid, error: null, usage };
}

/** Valida la salida completa; si falla, rescata los análisis individuales válidos. */
export function validateOutput(raw: unknown): { analyses: ClaudeAnalysis[]; invalid: number } {
  const full = ClaudeOutputSchema.safeParse(raw);
  if (full.success) return { analyses: full.data.analyses, invalid: 0 };
  const items = (raw as { analyses?: unknown })?.analyses;
  if (!Array.isArray(items)) return { analyses: [], invalid: 0 };
  const analyses: ClaudeAnalysis[] = [];
  let invalid = 0;
  for (const item of items) {
    const one = ClaudeAnalysisSchema.safeParse(item);
    if (one.success) analyses.push(one.data);
    else invalid++;
  }
  return { analyses, invalid };
}

function modelFrom(result: Msg | undefined): string | null {
  const mu = result?.modelUsage;
  return mu && typeof mu === "object" ? Object.keys(mu as object).join(", ") || null : null;
}

function pickScalars(m: Msg): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (obj: Msg, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Msg, `${prefix}${k}.`);
      else if (typeof v !== "object") out[`${prefix}${k}`] = v;
    }
  };
  walk(m, "");
  return out;
}
