/**
 * Fase de búsqueda: Claude usa las herramientas oficiales de servidor
 * web_search y web_fetch (ejecutadas por Anthropic) y entrega las ofertas con
 * la herramienta `submit_job_candidates`.
 *
 * - No se inicia sesión en ningún sitio ni se usan credenciales.
 * - web_fetch está bloqueado para linkedin.com e infojobs.net: de esas
 *   plataformas solo se usa lo que aparece públicamente en los resultados de
 *   búsqueda. (web_fetch además respeta robots.txt.)
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config/env.js";
import type { QueryBatch } from "../config/searchQueries.js";
import { errorMessage, type Logger } from "../lib/logger.js";
import { sourceFromUrl } from "../dedup/identity.js";
import type { RawCandidate, SourceStats } from "../sources/types.js";
import { contentForEcho, describeApiError, FALLBACK_BETA, isFatalApiError } from "./client.js";
import { DISCOVERY_SYSTEM_PROMPT, discoveryUserMessage } from "./prompts.js";
import { DiscoverySubmissionSchema, submitCandidatesTool } from "./schemas.js";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

const MAX_LOOP_ITERATIONS = 15;

export const FETCH_BLOCKED_DOMAINS = ["linkedin.com", "infojobs.net"];

export interface DiscoveryResult {
  candidates: RawCandidate[];
  stats: SourceStats;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
}

/** Error que detiene toda la búsqueda (p. ej. API key inválida). */
export class FatalSearchError extends Error {}

export function buildDiscoveryTools(env: Env) {
  return [
    {
      type: "web_search_20260318" as const,
      name: "web_search" as const,
      max_uses: env.MAX_SEARCHES_PER_BATCH,
      user_location: {
        type: "approximate" as const,
        city: "Valencia",
        country: "ES",
        timezone: "Europe/Madrid",
      },
    },
    {
      type: "web_fetch_20260318" as const,
      name: "web_fetch" as const,
      max_uses: env.MAX_FETCHES_PER_BATCH,
      blocked_domains: FETCH_BLOCKED_DOMAINS,
      max_content_tokens: 12000,
    },
    submitCandidatesTool,
  ];
}

export async function discoverBatch(
  client: Anthropic,
  env: Env,
  batch: QueryBatch,
  date: string,
  log: Logger,
): Promise<DiscoveryResult> {
  const stats: SourceStats = {
    source: `claude:${batch.id}`,
    searches: 0,
    fetches: 0,
    results: 0,
    candidates: 0,
    errors: [],
  };
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  const candidates: RawCandidate[] = [];
  const tools = env.MAX_FETCHES_PER_BATCH > 0 ? buildDiscoveryTools(env) : buildDiscoveryTools(env).filter((t) => t.name !== "web_fetch");

  const messages: BetaMessageParam[] = [
    { role: "user", content: discoveryUserMessage(batch, date, env.MAX_SEARCHES_PER_BATCH) },
  ];

  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
    let response: BetaMessage;
    try {
      response = await client.beta.messages
        .stream({
          model: env.CLAUDE_MODEL,
          max_tokens: 32000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: env.CLAUDE_SEARCH_EFFORT },
          system: [{ type: "text", text: DISCOVERY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
        })
        .finalMessage();
    } catch (err) {
      const msg = describeApiError(err);
      stats.errors.push(msg);
      log.error("Error de Claude en la búsqueda", { batch: batch.id, error: errorMessage(msg) });
      if (isFatalApiError(err)) throw new FatalSearchError(msg);
      break;
    }

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    stats.searches += response.usage.server_tool_use?.web_search_requests ?? 0;
    stats.fetches += response.usage.server_tool_use?.web_fetch_requests ?? 0;
    stats.results += countSearchResults(response);
    collectToolErrors(response, stats);

    if (response.stop_reason === "refusal") {
      const msg = `Claude rechazó la petición (${response.stop_details?.category ?? "sin categoría"})`;
      stats.errors.push(msg);
      log.warn(msg, { batch: batch.id });
      break;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
    );

    // Recoge las ofertas entregadas.
    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (use.name !== submitCandidatesTool.name) {
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: "Herramienta desconocida", is_error: true });
        continue;
      }
      const parsed = DiscoverySubmissionSchema.safeParse(use.input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        stats.errors.push(`Entrega con formato inválido: ${issue?.path.join(".")} ${issue?.message}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: "Formato inválido; revisa el esquema y vuelve a enviar.",
          is_error: true,
        });
        continue;
      }
      for (const job of parsed.data.candidates) {
        if (!isHttpUrl(job.url)) continue;
        candidates.push({
          source: sourceFromUrl(job.url),
          url: job.url,
          title: job.title.trim(),
          company: job.company?.trim() || null,
          location: job.location?.trim() || null,
          published_at: job.published_at,
          details: job.details.slice(0, 8000),
          details_origin: job.details_origin,
          discovered_via: "claude_web_search",
        });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: `Recibidas ${parsed.data.candidates.length} ofertas. Continúa buscando si te quedan búsquedas útiles; si no, termina.`,
      });
    }

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: contentForEcho(response.content) });
      continue;
    }
    if (response.stop_reason === "tool_use" && toolResults.length > 0) {
      messages.push({ role: "assistant", content: contentForEcho(response.content) });
      // Solo tool_result en este mensaje (requisito de la API).
      messages.push({ role: "user", content: toolResults });
      continue;
    }
    if (response.stop_reason === "max_tokens") {
      stats.errors.push("Respuesta cortada por max_tokens");
      log.warn("Respuesta de búsqueda cortada por max_tokens", { batch: batch.id });
    }
    break; // end_turn, max_tokens u otros
  }

  stats.candidates = candidates.length;
  log.info("Lote de búsqueda terminado", {
    batch: batch.id,
    searches: stats.searches,
    fetches: stats.fetches,
    results: stats.results,
    candidates: stats.candidates,
    errors: stats.errors.length,
  });
  return { candidates, stats, usage };
}

function countSearchResults(response: BetaMessage): number {
  let n = 0;
  for (const block of response.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) n += block.content.length;
  }
  return n;
}

function collectToolErrors(response: BetaMessage, stats: SourceStats) {
  for (const block of response.content) {
    if (block.type === "web_search_tool_result" && !Array.isArray(block.content)) {
      stats.errors.push(`web_search: ${block.content.error_code}`);
    }
    if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_tool_result_error") {
      // url_not_allowed / url_not_accessible son normales (robots.txt, dominios bloqueados).
      if (!["url_not_allowed", "url_not_accessible", "url_not_in_prior_context"].includes(block.content.error_code)) {
        stats.errors.push(`web_fetch: ${block.content.error_code}`);
      }
    }
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
