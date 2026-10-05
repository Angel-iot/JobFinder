/**
 * Portales de empleo REMOTO con API pública y gratuita, cuyo uso automatizado
 * está permitido por sus condiciones (todas piden enlazar a la oferta original
 * y citar la fuente: el panel muestra la fuente y enlaza a su URL).
 *
 * - Himalayas  https://himalayas.app/api          · búsqueda con country=ES (admite España)
 * - Remotive   https://remotive.com/api/remote-jobs · máx. ~4 peticiones/día → 1 por ejecución
 * - Remote OK  https://remoteok.com/api           · 1 petición por ejecución
 * - Arbeitnow  https://www.arbeitnow.com/api/job-board-api · se usan solo las marcadas remote
 */
import { z } from "zod";
import { sourceFromUrl } from "../../dedup/identity.js";
import { errorMessage } from "../../lib/logger.js";
import { emptyHints, type SourceName, type SourceResult, type V2Candidate } from "../types.js";
import { epochToIso, getJson, htmlToText, sleep, toNumberOrNull, type FetchLike } from "./http.js";

export interface SourceOptions {
  fetchImpl?: FetchLike;
  /** Pausa entre peticiones a la misma API (ms). */
  delayMs?: number;
}

const DETAILS_MAX = 6000;

async function timed(source: SourceName, fn: (r: SourceResult) => Promise<void>): Promise<SourceResult> {
  const result: SourceResult = { source, enabled: true, requests: 0, fetched: 0, candidates: [], errors: [], duration_ms: 0 };
  const start = Date.now();
  try {
    await fn(result);
  } catch (err) {
    result.errors.push(errorMessage(err));
  }
  result.duration_ms = Date.now() - start;
  return result;
}

function mapEmployment(value: string | null | undefined): V2Candidate["hints"]["employment_type"] {
  const v = (value ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!v) return null;
  if (v.includes("parttime")) return "part_time";
  if (v.includes("fulltime")) return "full_time";
  if (v.includes("intern")) return "internship";
  if (v.includes("contract") || v.includes("freelance")) return "freelance";
  return null;
}

// ---------------------------------------------------------------- Himalayas

export const HIMALAYAS_QUERIES = [
  "helpdesk",
  "help desk",
  "service desk",
  "it support",
  "technical support",
  "desktop support",
  "system administrator",
  "sysadmin",
  "linux support",
  "soporte",
];

const HimalayasJob = z
  .object({
    title: z.string(),
    companyName: z.string().nullish(),
    employmentType: z.string().nullish(),
    minSalary: z.union([z.number(), z.string()]).nullish(),
    maxSalary: z.union([z.number(), z.string()]).nullish(),
    currency: z.string().nullish(),
    salaryPeriod: z.string().nullish(),
    seniority: z.array(z.string()).nullish(),
    locationRestrictions: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    excerpt: z.string().nullish(),
    pubDate: z.union([z.number(), z.string()]).nullish(),
    applicationLink: z.string().nullish(),
    guid: z.string().nullish(),
  })
  .passthrough();

export function fetchHimalayas(opts: SourceOptions = {}): Promise<SourceResult> {
  return timed("himalayas", async (r) => {
    for (const q of HIMALAYAS_QUERIES) {
      const url = `https://himalayas.app/jobs/api/search?${new URLSearchParams({ q, country: "ES" })}`;
      try {
        r.requests++;
        const body = z.object({ jobs: z.array(z.unknown()).default([]) }).passthrough().parse(await getJson(url, opts));
        r.fetched += body.jobs.length;
        for (const raw of body.jobs) {
          const job = HimalayasJob.safeParse(raw);
          if (!job.success) continue;
          const j = job.data;
          const link = j.guid ?? j.applicationLink;
          if (!link) continue;
          const restrictions = j.locationRestrictions ?? [];
          r.candidates.push({
            api: "himalayas",
            source: sourceFromUrl(link),
            url: link,
            title: j.title.trim(),
            company: j.companyName?.trim() || null,
            location: restrictions.length ? restrictions.join(", ") : "Remoto (sin restricción de país)",
            published_at: epochToIso(j.pubDate),
            details: htmlToText(j.description ?? j.excerpt).slice(0, DETAILS_MAX),
            details_origin: "official_api",
            discovered_via: "official_api",
            hints: emptyHints({
              employment_type: mapEmployment(j.employmentType),
              remote_board: true,
              location_restriction: restrictions.length ? restrictions.join(", ") : "Worldwide",
              // La búsqueda se hace con country=ES: Himalayas solo devuelve ofertas que admiten España.
              spain_allowed_by_query: true,
              seniority: j.seniority ?? [],
              salary_min: toNumberOrNull(j.minSalary),
              salary_max: toNumberOrNull(j.maxSalary),
              salary_currency: j.currency && j.currency !== "None" ? j.currency : null,
              salary_period: j.salaryPeriod === "annual" ? "year" : j.salaryPeriod === "monthly" ? "month" : j.salaryPeriod === "hourly" ? "hour" : null,
            }),
          });
        }
      } catch (err) {
        r.errors.push(`"${q}": ${errorMessage(err)}`);
      }
      await sleep(opts.delayMs ?? 1500);
    }
  });
}

// ---------------------------------------------------------------- Remotive

const RemotiveJob = z
  .object({
    url: z.string(),
    title: z.string(),
    company_name: z.string().nullish(),
    job_type: z.string().nullish(),
    publication_date: z.string().nullish(),
    candidate_required_location: z.string().nullish(),
    salary: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

export function fetchRemotive(opts: SourceOptions = {}): Promise<SourceResult> {
  return timed("remotive", async (r) => {
    // Una sola petición diaria (sus condiciones piden máx. ~4 al día).
    r.requests++;
    const body = z.object({ jobs: z.array(z.unknown()).default([]) }).passthrough().parse(
      await getJson("https://remotive.com/api/remote-jobs", { ...opts, timeoutMs: 60_000 }),
    );
    r.fetched = body.jobs.length;
    for (const raw of body.jobs) {
      const job = RemotiveJob.safeParse(raw);
      if (!job.success) continue;
      const j = job.data;
      const salaryLine = j.salary?.trim() ? `Salario (según Remotive): ${j.salary.trim()}\n` : "";
      r.candidates.push({
        api: "remotive",
        source: sourceFromUrl(j.url),
        url: j.url,
        title: j.title.trim(),
        company: j.company_name?.trim() || null,
        location: j.candidate_required_location?.trim() || null,
        published_at: j.publication_date ? new Date(`${j.publication_date}Z`).toISOString() : null,
        details: (salaryLine + htmlToText(j.description)).slice(0, DETAILS_MAX),
        details_origin: "official_api",
        discovered_via: "official_api",
        hints: emptyHints({
          employment_type: mapEmployment(j.job_type),
          remote_board: true,
          location_restriction: j.candidate_required_location?.trim() || null,
        }),
      });
    }
  });
}

// ---------------------------------------------------------------- Remote OK

const RemoteOkJob = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    position: z.string(),
    company: z.string().nullish(),
    location: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    date: z.string().nullish(),
    url: z.string().nullish(),
    salary_min: z.union([z.number(), z.string()]).nullish(),
    salary_max: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

export function fetchRemoteOk(opts: SourceOptions = {}): Promise<SourceResult> {
  return timed("remoteok", async (r) => {
    r.requests++;
    const body = z.array(z.unknown()).parse(await getJson("https://remoteok.com/api", { ...opts, timeoutMs: 60_000 }));
    // El primer elemento es el aviso legal de la API.
    const jobs = body.slice(1);
    r.fetched = jobs.length;
    for (const raw of jobs) {
      const job = RemoteOkJob.safeParse(raw);
      if (!job.success || !job.data.url) continue;
      const j = job.data;
      const tags = j.tags ?? [];
      r.candidates.push({
        api: "remoteok",
        source: sourceFromUrl(j.url!),
        url: j.url!,
        title: j.position.trim(),
        company: j.company?.trim() || null,
        location: j.location?.trim() || null,
        published_at: j.date ?? null,
        details: ((tags.length ? `Etiquetas: ${tags.join(", ")}\n` : "") + htmlToText(j.description)).slice(0, DETAILS_MAX),
        details_origin: "official_api",
        discovered_via: "official_api",
        hints: emptyHints({
          employment_type: tags.some((t) => /part[\s-]?time/i.test(t)) ? "part_time" : null,
          remote_board: true,
          location_restriction: j.location?.trim() || null,
          salary_min: toNumberOrNull(j.salary_min),
          salary_max: toNumberOrNull(j.salary_max),
          salary_currency: toNumberOrNull(j.salary_min) || toNumberOrNull(j.salary_max) ? "USD" : null,
          salary_period: toNumberOrNull(j.salary_min) || toNumberOrNull(j.salary_max) ? "year" : null,
        }),
      });
    }
  });
}

// ---------------------------------------------------------------- Arbeitnow

const ArbeitnowJob = z
  .object({
    title: z.string(),
    company_name: z.string().nullish(),
    description: z.string().nullish(),
    remote: z.boolean().nullish(),
    url: z.string(),
    tags: z.array(z.string()).nullish(),
    job_types: z.array(z.string()).nullish(),
    location: z.string().nullish(),
    created_at: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

export const ARBEITNOW_MAX_PAGES = 3;

export function fetchArbeitnow(opts: SourceOptions = {}): Promise<SourceResult> {
  return timed("arbeitnow", async (r) => {
    for (let page = 1; page <= ARBEITNOW_MAX_PAGES; page++) {
      r.requests++;
      const body = z
        .object({ data: z.array(z.unknown()).default([]), links: z.object({ next: z.string().nullish() }).passthrough().nullish() })
        .passthrough()
        .parse(await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, opts));
      r.fetched += body.data.length;
      for (const raw of body.data) {
        const job = ArbeitnowJob.safeParse(raw);
        if (!job.success || !job.data.remote) continue; // solo ofertas marcadas como remotas
        const j = job.data;
        const types = j.job_types ?? [];
        r.candidates.push({
          api: "arbeitnow",
          source: sourceFromUrl(j.url),
          url: j.url,
          title: j.title.trim(),
          company: j.company_name?.trim() || null,
          location: j.location?.trim() || null,
          published_at: epochToIso(j.created_at),
          details: ((types.length ? `Tipo: ${types.join(", ")}\n` : "") + htmlToText(j.description)).slice(0, DETAILS_MAX),
          details_origin: "official_api",
          discovered_via: "official_api",
          hints: emptyHints({
            employment_type: mapEmployment(types.join(" ")),
            remote_board: true,
            // Arbeitnow marca "remote" pero no dice desde qué países: se trata como ambiguo.
            location_restriction: j.location?.trim() ? `Empresa en ${j.location.trim()}` : null,
          }),
        });
      }
      if (!body.links?.next) break;
      await sleep(opts.delayMs ?? 1000);
    }
  });
}
