/**
 * Fase de análisis: Claude extrae los datos estructurados de cada oferta y
 * hace la valoración subjetiva. Salida con structured outputs (JSON validado
 * contra el esquema zod antes de usarlo).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Env } from "../config/env.js";
import type { IdentifiedCandidate } from "../dedup/dedup.js";
import type { Logger } from "../lib/logger.js";
import { describeApiError, FALLBACK_BETA } from "./client.js";
import { EVALUATION_SYSTEM_PROMPT, evaluationUserMessage } from "./prompts.js";
import { EvaluationBatchSchema, JobEvaluationSchema, type JobEvaluation } from "./schemas.js";

export const EVAL_BATCH_SIZE = 5;

export interface EvaluationOutcome {
  evaluated: { candidate: IdentifiedCandidate; evaluation: JobEvaluation }[];
  failed: { candidate: IdentifiedCandidate; error: string }[];
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
}

export async function evaluateCandidates(
  client: Anthropic,
  env: Env,
  candidates: IdentifiedCandidate[],
  date: string,
  log: Logger,
): Promise<EvaluationOutcome> {
  const outcome: EvaluationOutcome = {
    evaluated: [],
    failed: [],
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
  };

  for (let i = 0; i < candidates.length; i += EVAL_BATCH_SIZE) {
    const batch = candidates.slice(i, i + EVAL_BATCH_SIZE);
    const result = await evaluateBatch(client, env, batch, date, outcome.usage);

    if (result.ok) {
      const byIndex = new Map(result.evaluations.map((e) => [e.candidate_index, e]));
      const missing: IdentifiedCandidate[] = [];
      batch.forEach((candidate, idx) => {
        const evaluation = byIndex.get(idx);
        if (evaluation) outcome.evaluated.push({ candidate, evaluation });
        else missing.push(candidate);
      });
      // Reintento individual de los que falten en la respuesta.
      for (const candidate of missing) await retrySingle(client, env, candidate, date, outcome, log);
    } else {
      log.warn("Fallo evaluando lote; reintentando uno a uno", { error: result.error, size: batch.length });
      for (const candidate of batch) await retrySingle(client, env, candidate, date, outcome, log);
    }
  }

  log.info("Análisis terminado", { evaluated: outcome.evaluated.length, failed: outcome.failed.length });
  return outcome;
}

async function retrySingle(
  client: Anthropic,
  env: Env,
  candidate: IdentifiedCandidate,
  date: string,
  outcome: EvaluationOutcome,
  log: Logger,
) {
  const single = await evaluateBatch(client, env, [candidate], date, outcome.usage);
  const evaluation = single.ok ? single.evaluations.find((e) => e.candidate_index === 0) : undefined;
  if (evaluation) {
    outcome.evaluated.push({ candidate, evaluation });
  } else {
    const error = single.ok ? "Claude no devolvió evaluación" : single.error;
    outcome.failed.push({ candidate, error });
    log.warn("No se pudo evaluar la oferta", { url: candidate.canonical_url, error });
  }
}

type BatchResult = { ok: true; evaluations: JobEvaluation[] } | { ok: false; error: string };

async function evaluateBatch(
  client: Anthropic,
  env: Env,
  batch: IdentifiedCandidate[],
  date: string,
  usage: EvaluationOutcome["usage"],
): Promise<BatchResult> {
  const request = () =>
    client.beta.messages.parse({
      model: env.CLAUDE_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: env.CLAUDE_EVAL_EFFORT, format: betaZodOutputFormat(EvaluationBatchSchema) },
      system: [{ type: "text", text: EVALUATION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: evaluationUserMessage(batch, date) }],
    });
  let response: Awaited<ReturnType<typeof request>>;
  try {
    response = await request();
  } catch (err) {
    return { ok: false, error: describeApiError(err) };
  }

  usage.input_tokens += response.usage.input_tokens;
  usage.output_tokens += response.usage.output_tokens;
  usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

  if (response.stop_reason === "refusal") {
    return { ok: false, error: `Claude rechazó la evaluación (${response.stop_details?.category ?? "sin categoría"})` };
  }
  if (response.stop_reason === "max_tokens") {
    return { ok: false, error: "Evaluación cortada por max_tokens" };
  }

  // Validación explícita antes de usar el JSON (además de la del SDK).
  const parsed = EvaluationBatchSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    return { ok: false, error: `JSON de evaluación inválido: ${parsed.error.issues[0]?.message ?? "desconocido"}` };
  }
  const valid = parsed.data.evaluations.filter(
    (e) => e.candidate_index >= 0 && e.candidate_index < batch.length && JobEvaluationSchema.safeParse(e).success,
  );
  return { ok: true, evaluations: valid };
}
