/**
 * Pipeline diario: BUSCA → ANALIZA → FILTRA → DEDUPLICA → GUARDA.
 * No aplica a ninguna oferta: solo las guarda para que el usuario decida.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./config/env.js";
import { preferences } from "./config/preferences.js";
import { queryBatches, type QueryBatch } from "./config/searchQueries.js";
import { discoverBatch, FatalSearchError, type DiscoveryResult } from "./claude/discover.js";
import { evaluateCandidates, type EvaluationOutcome } from "./claude/evaluate.js";
import type { JobEvaluation } from "./claude/schemas.js";
import { dedupeCandidates, findExisting, type IdentifiedCandidate } from "./dedup/dedup.js";
import { contentHash } from "./dedup/identity.js";
import { errorMessage, type Logger } from "./lib/logger.js";
import { applyHardFilters } from "./scoring/hardFilters.js";
import { mergeRedFlags, scoreJob, type ScoreResult } from "./scoring/score.js";
import { fetchInfojobsCandidates, infojobsEnabled } from "./sources/infojobsApi.js";
import type { RawCandidate, SourceStats } from "./sources/types.js";
import type { JobRow, JobsRepository, KnownJob, RunStatus } from "./storage/repository.js";

export interface PipelineDeps {
  env: Env;
  repo: JobsRepository;
  claude: Anthropic;
  log: Logger;
  /** Inyectables para tests. */
  discover?: (batch: QueryBatch) => Promise<DiscoveryResult>;
  evaluate?: (candidates: IdentifiedCandidate[]) => Promise<EvaluationOutcome>;
  infojobs?: () => Promise<{ candidates: RawCandidate[]; stats: SourceStats }>;
  batches?: QueryBatch[];
}

export interface PipelineOptions {
  runDate: string;
  trigger: string;
  force: boolean;
}

export interface RunStats {
  run_date: string;
  trigger: string;
  started_at: string;
  finished_at?: string;
  duration_s?: number;
  searches: number;
  fetches: number;
  search_results: number;
  candidates_found: number;
  unique_candidates: number;
  skipped_dismissed: number;
  skipped_previously_rejected: number;
  already_known: number;
  evaluated: number;
  evaluation_failed: number;
  discarded_hard_filters: number;
  discarded_low_score: number;
  inserted: number;
  saved_updated: number;
  relevant_today: number;
  by_source: Record<string, number>;
  discard_reasons: Record<string, number>;
  sources: SourceStats[];
  tokens: { input: number; output: number; cache_read: number };
  model: string;
}

export type PipelineResult =
  | { kind: "skipped"; reason: string }
  | { kind: "completed"; status: RunStatus; stats: RunStats; errors: string[] };

export async function runDailySearch(deps: PipelineDeps, opts: PipelineOptions): Promise<PipelineResult> {
  const { env, repo, log } = deps;
  const userId = env.JOBFINDER_USER_ID;
  const startedAt = new Date();

  // 0. Protección contra ejecuciones dobles el mismo día (fecha de Madrid).
  const start = await repo.startRun(userId, opts.runDate, opts.trigger, { force: opts.force });
  if (!start.started) {
    log.info("Búsqueda omitida", { reason: start.reason, run_date: opts.runDate });
    return { kind: "skipped", reason: start.reason };
  }
  const runId = start.run.id;
  log.info("Búsqueda iniciada", { run_id: runId, run_date: opts.runDate, attempt: start.run.attempts, trigger: opts.trigger });

  const errors: string[] = [];
  const stats: RunStats = {
    run_date: opts.runDate,
    trigger: opts.trigger,
    started_at: startedAt.toISOString(),
    searches: 0,
    fetches: 0,
    search_results: 0,
    candidates_found: 0,
    unique_candidates: 0,
    skipped_dismissed: 0,
    skipped_previously_rejected: 0,
    already_known: 0,
    evaluated: 0,
    evaluation_failed: 0,
    discarded_hard_filters: 0,
    discarded_low_score: 0,
    inserted: 0,
    saved_updated: 0,
    relevant_today: 0,
    by_source: {},
    discard_reasons: {},
    sources: [],
    tokens: { input: 0, output: 0, cache_read: 0 },
    model: env.CLAUDE_MODEL,
  };

  try {
    // 1. BUSCA
    const raw = await gatherCandidates(deps, opts.runDate, stats, errors);
    stats.candidates_found = raw.length;

    // 2. DEDUPLICA (dentro de la ejecución)
    const unique = dedupeCandidates(raw);
    stats.unique_candidates = unique.length;
    log.info("Candidatos únicos", { found: raw.length, unique: unique.length });

    // 3. Cruza con lo que ya existe
    const [known, rejections] = await Promise.all([repo.loadKnownJobs(userId), repo.loadRejections(userId)]);
    const rejectedUrls = new Set(rejections.map((r) => r.canonical_url));
    const nowIso = new Date().toISOString();

    const toEvaluate: IdentifiedCandidate[] = [];
    const existingFor = new Map<IdentifiedCandidate, KnownJob>();
    for (const c of unique) {
      const existing = findExisting(c, known);
      if (existing?.status === "dismissed") {
        stats.skipped_dismissed++; // descartada por el usuario: no vuelve a aparecer
        continue;
      }
      if (!existing && (rejectedUrls.has(c.canonical_url) || c.alternate_urls.some((u) => rejectedUrls.has(u)))) {
        stats.skipped_previously_rejected++;
        continue;
      }
      if (existing?.status === "new") {
        // Ya analizada y sin acción del usuario: sigue activa → aparece hoy.
        stats.already_known++;
        await repo.touchJob(existing.id, {
          last_seen_at: nowIso,
          last_seen_date: opts.runDate,
          last_run_id: runId,
          alternate_urls: mergeUrls(existing, c),
        });
        continue;
      }
      if (existing?.status === "saved") existingFor.set(c, existing); // se re-analiza para detectar cambios
      toEvaluate.push(c);
    }

    // 4. ANALIZA
    const evaluate = deps.evaluate ?? ((cs) => evaluateCandidates(deps.claude, env, cs, opts.runDate, log));
    const outcome = toEvaluate.length ? await evaluate(toEvaluate) : emptyOutcome();
    stats.evaluated = outcome.evaluated.length;
    stats.evaluation_failed = outcome.failed.length;
    addTokens(stats, outcome.usage);
    if (outcome.failed.length) errors.push(`${outcome.failed.length} ofertas no se pudieron analizar`);

    // 5. FILTRA + PUNTÚA + GUARDA
    for (const { candidate, evaluation } of outcome.evaluated) {
      try {
        await persistEvaluated(deps, opts, runId, nowIso, candidate, evaluation, existingFor.get(candidate), stats);
      } catch (err) {
        errors.push(errorMessage(err));
        log.error("Error guardando oferta", { url: candidate.canonical_url, error: errorMessage(err) });
      }
    }

    stats.relevant_today = stats.inserted + stats.saved_updated + stats.already_known;
  } catch (err) {
    errors.push(errorMessage(err));
    log.error("Error fatal en la búsqueda", { error: errorMessage(err) });
  }

  const finishedAt = new Date();
  stats.finished_at = finishedAt.toISOString();
  stats.duration_s = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  const status = decideStatus(stats, errors);
  try {
    await repo.finishRun(runId, status, stats as unknown as Record<string, unknown>, errors.slice(0, 100));
  } catch (err) {
    errors.push(errorMessage(err));
    log.error("No se pudo cerrar el registro de la ejecución", { error: errorMessage(err) });
  }
  log.info("Búsqueda terminada", { status, ...summaryForLog(stats), errors: errors.length });
  return { kind: "completed", status, stats, errors };
}

async function gatherCandidates(deps: PipelineDeps, runDate: string, stats: RunStats, errors: string[]) {
  const { env, log } = deps;
  const raw: RawCandidate[] = [];
  const discover = deps.discover ?? ((b) => discoverBatch(deps.claude, env, b, runDate, log));

  for (const batch of deps.batches ?? queryBatches) {
    try {
      const result = await discover(batch);
      raw.push(...result.candidates);
      stats.sources.push(result.stats);
      addTokens(stats, result.usage);
      errors.push(...result.stats.errors.map((e) => `[${result.stats.source}] ${e}`));
    } catch (err) {
      errors.push(`[claude:${batch.id}] ${errorMessage(err)}`);
      log.error("Lote de búsqueda fallido", { batch: batch.id, error: errorMessage(err) });
      stats.sources.push({ source: `claude:${batch.id}`, searches: 0, fetches: 0, results: 0, candidates: 0, errors: [errorMessage(err)] });
      if (err instanceof FatalSearchError) break; // no tiene sentido seguir con los demás lotes
    }
  }

  const infojobs = deps.infojobs ?? (infojobsEnabled(env) ? () => fetchInfojobsCandidates(env, log) : null);
  if (infojobs) {
    try {
      const result = await infojobs();
      raw.push(...result.candidates);
      stats.sources.push(result.stats);
      errors.push(...result.stats.errors.map((e) => `[infojobs_api] ${e}`));
    } catch (err) {
      errors.push(`[infojobs_api] ${errorMessage(err)}`);
    }
  }

  for (const s of stats.sources) {
    stats.searches += s.searches;
    stats.fetches += s.fetches;
    stats.search_results += s.results;
  }
  return raw;
}

async function persistEvaluated(
  deps: PipelineDeps,
  opts: PipelineOptions,
  runId: string,
  nowIso: string,
  candidate: IdentifiedCandidate,
  evaluation: JobEvaluation,
  existing: KnownJob | undefined,
  stats: RunStats,
) {
  const { repo, env } = deps;
  const filter = applyHardFilters(evaluation);
  // Las guardadas se puntúan siempre (para no perder la nota si dejan de cumplir un filtro).
  const score = filter.passed || existing ? scoreJob(evaluation) : null;
  const hash = contentHash({
    title: evaluation.title || candidate.title,
    company: evaluation.company ?? candidate.company,
    remote_type: evaluation.remote_type,
    employment_type: evaluation.employment_type,
    hours_per_week: evaluation.hours_per_week,
    schedule: evaluation.schedule,
    salary_min: evaluation.salary_min,
    salary_max: evaluation.salary_max,
    english_level: evaluation.english_level_required,
    experience_years_min: evaluation.experience_years_min,
  });

  // Oferta guardada por el usuario: se actualiza y se marca si cambió.
  if (existing) {
    const changed = existing.content_hash !== hash;
    const row = buildRow(env.JOBFINDER_USER_ID, opts.runDate, runId, nowIso, candidate, evaluation, score, hash);
    const { first_seen_date: _first, found_at: _found, ...patch } = row;
    if (!filter.passed) patch.red_flags = mergeRedFlags(filter.reasons.map((r) => `Ya no cumple: ${r}`), patch.red_flags);
    await repo.updateJob(existing.id, {
      ...patch,
      alternate_urls: mergeUrls(existing, candidate),
      ...(changed ? { is_updated: true } : {}),
    });
    stats.saved_updated++;
    return;
  }

  if (!filter.passed || !score) {
    stats.discarded_hard_filters++;
    for (const r of filter.reasons) {
      const key = r.replace(/\d+(\.\d+)?/g, "N");
      stats.discard_reasons[key] = (stats.discard_reasons[key] ?? 0) + 1;
    }
    await repo.upsertRejection(rejectionRow(env.JOBFINDER_USER_ID, nowIso, candidate, hash, filter.reasons));
    return;
  }

  if (score.score < preferences.minScoreToStore) {
    stats.discarded_low_score++;
    await repo.upsertRejection(
      rejectionRow(env.JOBFINDER_USER_ID, nowIso, candidate, hash, [`Puntuación baja (${score.score})`]),
    );
    return;
  }

  await repo.insertJob(buildRow(env.JOBFINDER_USER_ID, opts.runDate, runId, nowIso, candidate, evaluation, score, hash));
  stats.inserted++;
  stats.by_source[candidate.source] = (stats.by_source[candidate.source] ?? 0) + 1;
}

export function buildRow(
  userId: string,
  runDate: string,
  runId: string,
  nowIso: string,
  c: IdentifiedCandidate,
  e: JobEvaluation,
  score: ScoreResult | null,
  hash: string,
): JobRow {
  return {
    user_id: userId,
    source: c.source,
    external_id: c.external_id,
    url: c.url,
    canonical_url: c.canonical_url,
    alternate_urls: c.alternate_urls,
    fingerprint: c.fingerprint,
    content_hash: hash,
    title: e.title || c.title,
    company: e.company ?? c.company,
    location: e.location ?? c.location,
    remote_type: e.remote_type,
    remote_scope: e.remote_scope,
    remote_location_ambiguous: e.remote_type === "full_remote" && e.remote_allows_spain !== "yes",
    employment_type: e.employment_type,
    hours_per_week: e.hours_per_week,
    schedule: e.schedule,
    schedule_start: e.schedule_start,
    schedule_end: e.schedule_end,
    salary_min: e.salary_min,
    salary_max: e.salary_max,
    salary_currency: e.salary_currency,
    salary_period: e.salary_period,
    salary_text: e.salary_text,
    experience_required: e.experience_required,
    experience_years_min: e.experience_years_min,
    education_required: e.education_required,
    english_level: e.english_level_required,
    seniority: e.seniority,
    description: c.details || null,
    summary: e.summary,
    requirements: e.requirements,
    technologies: e.technologies,
    training_info: e.training_info,
    growth_info: e.growth_info,
    match_reasons: e.match_reasons,
    red_flags: mergeRedFlags(e.red_flags, score?.warnings ?? []),
    score: score?.score ?? 0,
    score_reasons: score?.reasons ?? [],
    score_breakdown: { ...(score?.breakdown ?? {}), assessment: e.assessment, notes: e.assessment_notes, details_origin: c.details_origin },
    priority: score?.priority ?? "other",
    published_at: toIsoOrNull(c.published_at),
    found_at: nowIso,
    last_seen_at: nowIso,
    first_seen_date: runDate,
    last_seen_date: runDate,
    last_run_id: isUuid(runId) ? runId : null,
  };
}

function rejectionRow(userId: string, nowIso: string, c: IdentifiedCandidate, hash: string, reasons: string[]) {
  return {
    user_id: userId,
    canonical_url: c.canonical_url,
    fingerprint: c.fingerprint,
    content_hash: hash,
    source: c.source,
    url: c.url,
    title: c.title,
    company: c.company,
    reasons,
    last_seen_at: nowIso,
  };
}

function mergeUrls(existing: KnownJob, c: IdentifiedCandidate): string[] {
  const urls = new Set([...existing.alternate_urls, ...c.alternate_urls]);
  if (c.canonical_url !== existing.canonical_url) urls.add(c.canonical_url);
  urls.delete(existing.canonical_url);
  return [...urls];
}

function decideStatus(stats: RunStats, errors: string[]): RunStatus {
  const claudeSources = stats.sources.filter((s) => s.source.startsWith("claude:"));
  const allSearchesFailed = claudeSources.length > 0 && claudeSources.every((s) => s.searches === 0 && s.errors.length > 0);
  if (stats.candidates_found === 0 && (allSearchesFailed || errors.length > 0)) return "failed";
  return errors.length ? "partial" : "success";
}

function addTokens(stats: RunStats, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number }) {
  stats.tokens.input += usage.input_tokens;
  stats.tokens.output += usage.output_tokens;
  stats.tokens.cache_read += usage.cache_read_input_tokens;
}

function emptyOutcome(): EvaluationOutcome {
  return { evaluated: [], failed: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 } };
}

function toIsoOrNull(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function summaryForLog(s: RunStats) {
  return {
    searches: s.searches,
    fetches: s.fetches,
    search_results: s.search_results,
    candidates_found: s.candidates_found,
    unique_candidates: s.unique_candidates,
    evaluated: s.evaluated,
    discarded_hard_filters: s.discarded_hard_filters,
    discarded_low_score: s.discarded_low_score,
    skipped_dismissed: s.skipped_dismissed,
    skipped_previously_rejected: s.skipped_previously_rejected,
    already_known: s.already_known,
    inserted: s.inserted,
    saved_updated: s.saved_updated,
    tokens: s.tokens,
  };
}
