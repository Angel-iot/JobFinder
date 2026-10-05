/**
 * Fuente OPCIONAL: API oficial de InfoJobs (https://developer.infojobs.net).
 *
 * Solo se activa si existen INFOJOBS_CLIENT_ID e INFOJOBS_CLIENT_SECRET
 * (credenciales de una aplicación registrada en el portal de desarrolladores,
 * NO las credenciales de tu cuenta). Autenticación: HTTP Basic con
 * clientId:clientSecret, según la documentación oficial.
 *
 * Endpoints usados:
 *   GET /api/9/offer        listado con filtros (q, teleworking, maxResults...)
 *   GET /api/7/offer/{id}   detalle (descripción, requisitos, horario...)
 * Las respuestas se validan de forma tolerante: los campos que no lleguen se
 * tratan como "no especificado".
 */
import { z } from "zod";
import type { Env } from "../config/env.js";
import { errorMessage, type Logger } from "../lib/logger.js";
import type { RawCandidate, SourceStats } from "./types.js";

const BASE_URL = "https://api.infojobs.net/api";
const KEYWORDS = ["helpdesk", "técnico informático", "soporte técnico", "técnico de sistemas", "service desk", "sysadmin"];
/** Valor del diccionario "teleworking" que aparece en la documentación oficial. */
const TELEWORKING_FILTER = "solo-teletrabajo";
const MAX_RESULTS = 50;
const MAX_DETAIL_REQUESTS = 40;
const REQUEST_DELAY_MS = 400;

const IdValue = z.object({ id: z.number().optional(), value: z.string().optional() }).partial().nullable().optional();

const ListOfferSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    link: z.string().optional(),
    city: z.string().nullable().optional(),
    province: IdValue,
    teleworking: IdValue,
    workDay: IdValue,
    salaryMin: IdValue,
    salaryMax: IdValue,
    salaryPeriod: IdValue,
    experienceMin: IdValue,
    contractType: IdValue,
    requirementMin: z.string().nullable().optional(),
    published: z.string().nullable().optional(),
    author: z.object({ name: z.string().optional() }).partial().nullable().optional(),
  })
  .passthrough();

const ListResponseSchema = z.object({ offers: z.array(z.unknown()).default([]) }).passthrough();

const DetailSchema = z
  .object({
    description: z.string().nullable().optional(),
    minRequirements: z.string().nullable().optional(),
    desiredRequirements: z.string().nullable().optional(),
    schedule: z.string().nullable().optional(),
    journey: IdValue,
    minPay: IdValue,
    maxPay: IdValue,
    experienceMin: IdValue,
    studiesMin: IdValue,
    link: z.string().optional(),
  })
  .passthrough();

export function infojobsEnabled(env: Pick<Env, "INFOJOBS_CLIENT_ID" | "INFOJOBS_CLIENT_SECRET">): boolean {
  return Boolean(env.INFOJOBS_CLIENT_ID && env.INFOJOBS_CLIENT_SECRET);
}

export async function fetchInfojobsCandidates(
  env: Pick<Env, "INFOJOBS_CLIENT_ID" | "INFOJOBS_CLIENT_SECRET">,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<{ candidates: RawCandidate[]; stats: SourceStats }> {
  const stats: SourceStats = { source: "infojobs_api", searches: 0, fetches: 0, results: 0, candidates: 0, errors: [] };
  const auth = "Basic " + Buffer.from(`${env.INFOJOBS_CLIENT_ID}:${env.INFOJOBS_CLIENT_SECRET}`).toString("base64");
  const headers = { Authorization: auth, Accept: "application/json" };

  const offers = new Map<string, z.infer<typeof ListOfferSchema>>();
  for (const q of KEYWORDS) {
    const params = new URLSearchParams({ q, teleworking: TELEWORKING_FILTER, maxResults: String(MAX_RESULTS) });
    try {
      stats.searches++;
      const res = await fetchImpl(`${BASE_URL}/9/offer?${params}`, { headers });
      if (!res.ok) {
        stats.errors.push(`InfoJobs listado "${q}": HTTP ${res.status}`);
        if (res.status === 401 || res.status === 403) break; // credenciales inválidas: no insistir
        continue;
      }
      const body = ListResponseSchema.parse(await res.json());
      for (const raw of body.offers) {
        const parsed = ListOfferSchema.safeParse(raw);
        if (parsed.success) offers.set(parsed.data.id, parsed.data);
      }
      stats.results += body.offers.length;
    } catch (err) {
      stats.errors.push(`InfoJobs listado "${q}": ${errorMessage(err)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const candidates: RawCandidate[] = [];
  let detailRequests = 0;
  for (const offer of offers.values()) {
    let detail: z.infer<typeof DetailSchema> | null = null;
    if (detailRequests < MAX_DETAIL_REQUESTS) {
      detailRequests++;
      try {
        stats.fetches++;
        const res = await fetchImpl(`${BASE_URL}/7/offer/${encodeURIComponent(offer.id)}`, { headers });
        if (res.ok) {
          const parsed = DetailSchema.safeParse(await res.json());
          if (parsed.success) detail = parsed.data;
        } else {
          stats.errors.push(`InfoJobs detalle ${offer.id}: HTTP ${res.status}`);
        }
      } catch (err) {
        stats.errors.push(`InfoJobs detalle ${offer.id}: ${errorMessage(err)}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
    const url = detail?.link ?? offer.link;
    if (!url) continue;
    candidates.push({
      source: "infojobs",
      url,
      title: offer.title,
      company: offer.author?.name ?? null,
      location: [offer.city, offer.province?.value].filter(Boolean).join(", ") || null,
      published_at: offer.published ?? null,
      details: infojobsDetailsText(offer, detail),
      details_origin: detail ? "official_api" : "search_snippet",
      discovered_via: "infojobs_api",
    });
  }
  stats.candidates = candidates.length;
  log.info("InfoJobs API terminada", { ...stats, errors: stats.errors.length });
  return { candidates, stats };
}

/** Construye el texto de la oferta solo con los campos que existen. */
export function infojobsDetailsText(
  offer: z.infer<typeof ListOfferSchema>,
  detail: z.infer<typeof DetailSchema> | null,
): string {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  add("Teletrabajo", offer.teleworking?.value);
  add("Jornada", detail?.journey?.value ?? offer.workDay?.value);
  add("Horario", detail?.schedule);
  add("Tipo de contrato", offer.contractType?.value);
  const min = detail?.minPay?.value ?? offer.salaryMin?.value;
  const max = detail?.maxPay?.value ?? offer.salaryMax?.value;
  if (min || max) add("Salario", `${min ?? "?"} - ${max ?? "?"} ${offer.salaryPeriod?.value ?? ""}`);
  add("Experiencia mínima", detail?.experienceMin?.value ?? offer.experienceMin?.value);
  add("Estudios mínimos", detail?.studiesMin?.value);
  add("Requisitos mínimos", detail?.minRequirements ?? offer.requirementMin);
  add("Requisitos deseados", detail?.desiredRequirements);
  add("Descripción", detail?.description);
  return lines.join("\n").slice(0, 8000);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
