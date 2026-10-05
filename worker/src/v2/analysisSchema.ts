/**
 * Contrato de salida de Claude (claude-code-action --json-schema).
 * El mismo esquema zod genera el JSON Schema que recibe Claude y valida su
 * respuesta antes de guardar nada en Supabase.
 */
import { z } from "zod";
import { JobEvaluationSchema } from "../claude/schemas.js";

export const ClaudeAnalysisSchema = JobEvaluationSchema.omit({ candidate_index: true }).extend({
  id: z.string().describe("Identificador del candidato (campo id del archivo de candidatos)."),
  score: z.number().int().describe("Puntuación final 0-100 según la rúbrica de las instrucciones."),
  score_rationale: z.string().describe("Explicación breve de la puntuación (1-3 frases)."),
});

export const ClaudeOutputSchema = z.object({
  analyses: z.array(ClaudeAnalysisSchema).describe("Un análisis por cada candidato recibido."),
});

export type ClaudeAnalysis = z.infer<typeof ClaudeAnalysisSchema>;
export type ClaudeOutput = z.infer<typeof ClaudeOutputSchema>;

/**
 * JSON Schema compacto, en una línea y sin comillas simples, apto para
 * pasarse entre comillas simples en `claude_args: --json-schema '...'`.
 */
export function claudeJsonSchemaString(): string {
  const schema = stripSafeIntBounds(z.toJSONSchema(ClaudeOutputSchema)) as Record<string, unknown>;
  delete schema.$schema;
  const json = JSON.stringify(schema).replace(/'/g, "’");
  if (json.includes("\n") || json.includes("'") || json.includes("$")) {
    throw new Error("El JSON Schema contiene caracteres no seguros para claude_args");
  }
  return json;
}

/** zod añade a los enteros los límites ±MAX_SAFE_INTEGER; no aportan nada y alargan el esquema. */
function stripSafeIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntBounds);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = stripSafeIntBounds(v);
  }
  return out;
}
