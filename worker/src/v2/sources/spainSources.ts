/**
 * Fuentes españolas con API oficial. Ambas son OPCIONALES y gratuitas, pero
 * requieren registrar una aplicación (credenciales de app, no de tu cuenta):
 *
 * - InfoJobs API (developer.infojobs.net): filtro oficial teleworking=solo-teletrabajo.
 * - Adzuna API (developer.adzuna.com): país "es"; uso permitido para "personal research";
 *   pide citar "The Adzuna API" como fuente. Límite gratuito: 250 llamadas/día.
 */
import { z } from "zod";
import { sourceFromUrl } from "../../dedup/identity.js";
import { errorMessage, type Logger } from "../../lib/logger.js";
import { fetchInfojobsCandidates } from "../../sources/infojobsApi.js";
import type { EnvV2 } from "../env.js";
import { emptyHints, type SourceResult, type V2Candidate } from "../types.js";
import { getJson, sleep, toNumberOrNull } from "./http.js";
import type { SourceOptions } from "./remoteBoards.js";

export function infojobsConfigured(env: EnvV2) {
  return Boolean(env.INFOJOBS_CLIENT_ID && env.INFOJOBS_CLIENT_SECRET);
}

export function adzunaConfigured(env: EnvV2) {
  return Boolean(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY);
}

/** Reutiliza el cliente de InfoJobs de la v1 y añade los datos estructurados de la API. */
export async function fetchInfojobsV2(env: EnvV2, log: Logger, opts: SourceOptions = {}): Promise<SourceResult> {
  const start = Date.now();
  if (!infojobsConfigured(env)) {
    return { source: "infojobs_api", enabled: false, requests: 0, fetched: 0, candidates: [], errors: [], duration_ms: 0 };
  }
  const { candidates, stats } = await fetchInfojobsCandidates(env, log, opts.fetchImpl);
  return {
    source: "infojobs_api",
    enabled: true,
    requests: stats.searches + stats.fetches,
    fetched: stats.results,
    candidates: candidates.map((c) => ({ ...c, api: "infojobs_api" as const, hints: infojobsHints(c.details) })),
    errors: stats.errors,
    duration_ms: Date.now() - start,
  };
}

/** Lee las líneas "Etiqueta: valor" que construye el cliente de InfoJobs. */
export function infojobsHints(details: string): V2Candidate["hints"] {
  const field = (label: string) => details.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? null;
  const teleworking = field("Teletrabajo");
  const workday = field("Jornada");
  const w = (workday ?? "").toLowerCase();
  return emptyHints({
    employment_type: /completa/.test(w) ? "full_time" : /parcial/.test(w) ? "part_time" : null,
    // La búsqueda pide teleworking=solo-teletrabajo; si la API lo confirma, es 100% remoto.
    remote_board: /solo teletrabajo|100\s*%\s*remoto/i.test(teleworking ?? ""),
    location_restriction: "España",
    spain_allowed_by_query: true,
    workday_text: workday,
  });
}

// ------------------------------------------------------------------ Adzuna

export const ADZUNA_QUERIES = [
  "helpdesk teletrabajo",
  "soporte informático remoto",
  "técnico de sistemas teletrabajo",
  "service desk remoto",
];

const AdzunaJob = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    title: z.string(),
    description: z.string().nullish(),
    redirect_url: z.string(),
    created: z.string().nullish(),
    company: z.object({ display_name: z.string().nullish() }).partial().nullish(),
    location: z.object({ display_name: z.string().nullish() }).partial().nullish(),
    salary_min: z.union([z.number(), z.string()]).nullish(),
    salary_max: z.union([z.number(), z.string()]).nullish(),
    salary_is_predicted: z.union([z.string(), z.number(), z.boolean()]).nullish(),
    contract_time: z.string().nullish(),
    contract_type: z.string().nullish(),
  })
  .passthrough();

export async function fetchAdzuna(env: EnvV2, opts: SourceOptions = {}): Promise<SourceResult> {
  const result: SourceResult = { source: "adzuna", enabled: adzunaConfigured(env), requests: 0, fetched: 0, candidates: [], errors: [], duration_ms: 0 };
  if (!result.enabled) return result;
  const start = Date.now();
  for (const what of ADZUNA_QUERIES) {
    const params = new URLSearchParams({
      app_id: env.ADZUNA_APP_ID!,
      app_key: env.ADZUNA_APP_KEY!,
      what,
      results_per_page: "50",
      max_days_old: "30",
      "content-type": "application/json",
    });
    try {
      result.requests++;
      const body = z.object({ results: z.array(z.unknown()).default([]) }).passthrough().parse(
        await getJson(`https://api.adzuna.com/v1/api/jobs/es/search/1?${params}`, opts),
      );
      result.fetched += body.results.length;
      for (const raw of body.results) {
        const job = AdzunaJob.safeParse(raw);
        if (!job.success) continue;
        const j = job.data;
        // Adzuna marca algunos salarios como "estimados": no se usan (no inventar).
        const predicted = String(j.salary_is_predicted ?? "0") === "1" || j.salary_is_predicted === true;
        result.candidates.push({
          api: "adzuna",
          source: sourceFromUrl(j.redirect_url),
          url: j.redirect_url,
          title: j.title.replace(/<[^>]+>/g, "").trim(),
          company: j.company?.display_name?.trim() || null,
          location: j.location?.display_name?.trim() || null,
          published_at: j.created ?? null,
          details: [
            j.contract_time ? `Jornada (Adzuna): ${j.contract_time}` : "",
            j.contract_type ? `Contrato (Adzuna): ${j.contract_type}` : "",
            (j.description ?? "").replace(/<[^>]+>/g, " "),
          ]
            .filter(Boolean)
            .join("\n"),
          // Adzuna solo devuelve un extracto de la descripción.
          details_origin: "search_snippet",
          discovered_via: "official_api",
          hints: emptyHints({
            employment_type: j.contract_time === "part_time" ? "part_time" : j.contract_time === "full_time" ? "full_time" : null,
            location_restriction: "España",
            salary_min: predicted ? null : toNumberOrNull(j.salary_min),
            salary_max: predicted ? null : toNumberOrNull(j.salary_max),
            salary_currency: !predicted && (toNumberOrNull(j.salary_min) || toNumberOrNull(j.salary_max)) ? "EUR" : null,
            // La API no indica el periodo del salario: no se asume ninguno.
            salary_period: null,
          }),
        });
      }
    } catch (err) {
      // No incluir la URL: contiene app_key.
      result.errors.push(`"${what}": ${errorMessage(err instanceof Error ? new Error(err.message) : err)}`);
    }
    await sleep(opts.delayMs ?? 1000);
  }
  result.duration_ms = Date.now() - start;
  return result;
}
