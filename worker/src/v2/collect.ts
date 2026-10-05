/**
 * PASO 1 del workflow v2 (sin IA, sin Anthropic):
 * APIs oficiales → relevancia → deduplicación → cruce con la BD →
 * filtros duros por código → candidatos para Claude (archivos en work/).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { preferences } from "../config/preferences.js";
import { dedupeCandidates, findExisting } from "../dedup/dedup.js";
import { contentHash } from "../dedup/identity.js";
import { errorMessage, type Logger } from "../lib/logger.js";
import { scoreJob } from "../scoring/score.js";
import { assessByCode } from "./codeEvaluation.js";
import type { EnvV2 } from "./env.js";
import { extractFacts } from "./facts.js";
import { renderCandidateFiles, renderInstructions } from "./instructions.js";
import { assessRelevance } from "./relevance.js";
import type { JobsRepositoryV2 } from "./repository.js";
import { fetchArbeitnow, fetchHimalayas, fetchRemoteOk, fetchRemotive } from "./sources/remoteBoards.js";
import { fetchAdzuna, fetchInfojobsV2 } from "./sources/spainSources.js";
import { emptyStats, writeState, type PreparedCandidate, type PlannedRejection, type V2Identified, type V2State } from "./state.js";
import type { SourceResult, V2Candidate } from "./types.js";

export interface CollectDeps {
  env: EnvV2;
  repo: JobsRepositoryV2;
  log: Logger;
  /** Inyectable para tests: devuelve los resultados de todas las fuentes. */
  fetchSources?: () => Promise<SourceResult[]>;
}

export interface CollectOptions {
  runDate: string;
  trigger: string;
  force: boolean;
}

export type CollectResult =
  | { started: false; reason: string }
  | { started: true; state: V2State; claudeCandidates: number };

export function defaultSources(env: EnvV2, log: Logger): () => Promise<SourceResult[]> {
  // Cada fuente es un host distinto: se consultan en paralelo; dentro de cada una, en serie con pausas.
  return () => Promise.all([fetchInfojobsV2(env, log), fetchAdzuna(env), fetchHimalayas(), fetchRemotive(), fetchRemoteOk(), fetchArbeitnow()]);
}

export function codeContentHash(c: V2Identified, e: PreparedCandidate["code_evaluation"]): string {
  return contentHash({
    title: c.title,
    company: c.company,
    remote_type: e.remote_type,
    employment_type: e.employment_type,
    hours_per_week: e.hours_per_week,
    schedule: e.schedule,
    salary_min: e.salary_min,
    salary_max: e.salary_max,
    english_level: e.english_level_required,
    experience_years_min: e.experience_years_min,
  });
}

export async function collect(deps: CollectDeps, opts: CollectOptions): Promise<CollectResult> {
  const { env, repo, log } = deps;
  const userId = env.JOBFINDER_USER_ID;
  const t0 = Date.now();

  const start = await repo.startRun(userId, opts.runDate, opts.trigger, { force: opts.force });
  if (!start.started) {
    log.info("Búsqueda omitida", { reason: start.reason });
    return { started: false, reason: start.reason };
  }

  const stats = emptyStats(opts.runDate, opts.trigger);
  const state: V2State = {
    version: 2,
    run_id: start.run.id,
    run_date: opts.runDate,
    attempt: start.run.attempts,
    stats,
    to_claude: [],
    code_only: [],
    rejections: [],
    touches: [],
    fatal_error: null,
  };
  log.info("Búsqueda v2 iniciada", { run_id: state.run_id, attempt: state.attempt });

  try {
    // 1. Fuentes oficiales
    const results = await (deps.fetchSources ?? defaultSources(env, log))();
    const relevant: V2Candidate[] = [];
    for (const r of results) {
      const s = stats.per_source[r.source];
      Object.assign(s, { enabled: r.enabled, requests: r.requests, fetched: r.fetched, candidates: r.candidates.length, errors: r.errors.length, duration_ms: r.duration_ms });
      stats.errors.push(...r.errors.map((e) => `[${r.source}] ${e}`));
      stats.candidates_found += r.candidates.length;
      // 2. Relevancia (puesto de soporte/sistemas)
      for (const c of r.candidates) {
        if (assessRelevance(c.title, c.details).relevant) {
          relevant.push(c);
          s.relevant++;
        } else {
          stats.discarded_relevance++;
        }
      }
      log.info("Fuente consultada", { source: r.source, enabled: r.enabled, fetched: r.fetched, relevant: s.relevant, errors: r.errors.length });
    }

    // 3. Deduplicación dentro de la ejecución
    const unique = dedupeCandidates(relevant) as V2Identified[];
    stats.unique_candidates = unique.length;

    // 4. Cruce con lo ya conocido
    const [known, rejections] = await Promise.all([repo.loadKnownJobsV2(userId), repo.loadRejections(userId)]);
    const rejectedUrls = new Set(rejections.map((r) => r.canonical_url));
    const fresh: PreparedCandidate[] = [];
    const pendingExisting: PreparedCandidate[] = [];

    for (const c of unique) {
      const existing = findExisting(c, known);
      if (existing?.status === "dismissed") {
        stats.skipped_dismissed++;
        continue;
      }
      if (!existing && (rejectedUrls.has(c.canonical_url) || c.alternate_urls.some((u) => rejectedUrls.has(u)))) {
        stats.skipped_previously_rejected++;
        continue;
      }

      const facts = extractFacts(c);
      const code = assessByCode(c, facts);
      const hash = codeContentHash(c, code.evaluation);
      const alternates = existing ? mergeUrls(existing.canonical_url, existing.alternate_urls, c) : [];

      if (existing) {
        const changed = existing.content_hash !== hash;
        // Ya analizada por Claude y sin cambios (o nueva sin cambios): solo se marca como vista hoy.
        if (existing.score_source === "claude" && (existing.status === "new" || !changed)) {
          stats.already_known++;
          state.touches.push({ job_id: existing.id, alternate_urls: alternates });
          continue;
        }
        // Guardada que ha cambiado, o puntuada antes solo por código: se re-analiza.
        pendingExisting.push({
          id: "",
          candidate: { ...c, alternate_urls: alternates },
          facts,
          code_evaluation: code.evaluation,
          // Se puntúa aunque ya no pase un filtro, para no perder la nota de una oferta guardada.
          code_score: code.score ?? scoreJob(code.evaluation),
          existing_job_id: existing.id,
          existing_status: existing.status === "saved" ? "saved" : "new",
        });
        continue;
      }

      // 5. Filtros duros por código (ANTES de Claude)
      if (!code.filter.passed || !code.score) {
        stats.discarded_hard_filters++;
        for (const reason of code.filter.reasons) {
          const key = reason.replace(/\d+(\.\d+)?/g, "N").replace(/\(.*\)/, "").trim();
          stats.discarded_by_filter[key] = (stats.discarded_by_filter[key] ?? 0) + 1;
        }
        state.rejections.push(rejection(c, code.filter.reasons, hash));
        continue;
      }
      stats.passed_filters++;
      fresh.push({ id: "", candidate: c, facts, code_evaluation: code.evaluation, code_score: code.score, existing_job_id: null, existing_status: null });
    }

    // 6. Selección para Claude: primero las nuevas con mejor nota de código, después las pendientes.
    fresh.sort((a, b) => b.code_score.score - a.code_score.score);
    const ordered = [...fresh, ...pendingExisting];
    const cap = env.MAX_CLAUDE_CANDIDATES;
    ordered.forEach((p, i) => (p.id = `c${String(i + 1).padStart(3, "0")}`));
    state.to_claude = ordered.slice(0, cap);
    for (const p of ordered.slice(cap)) {
      if (p.existing_job_id || p.code_score.score >= preferences.minScoreToStore) state.code_only.push(p);
      else {
        stats.discarded_low_score_code++;
        state.rejections.push(rejection(p.candidate, [`Puntuación baja por código (${p.code_score.score})`], codeContentHash(p.candidate, p.code_evaluation)));
      }
    }
    stats.sent_to_claude = state.to_claude.length;
  } catch (err) {
    state.fatal_error = errorMessage(err);
    stats.errors.push(state.fatal_error);
    log.error("Error en la recogida de ofertas", { error: state.fatal_error });
  }

  // 7. Archivos para Claude + estado
  writeClaudeInputs(env.WORK_DIR, state);
  stats.step_durations_s.collect = Math.round((Date.now() - t0) / 1000);
  writeState(env.WORK_DIR, state);
  log.info("Recogida terminada", {
    candidates_found: stats.candidates_found,
    discarded_relevance: stats.discarded_relevance,
    unique: stats.unique_candidates,
    discarded_hard_filters: stats.discarded_hard_filters,
    passed_filters: stats.passed_filters,
    sent_to_claude: stats.sent_to_claude,
    code_only: state.code_only.length,
  });
  return { started: true, state, claudeCandidates: state.to_claude.length };
}

export function writeClaudeInputs(workDir: string, state: V2State) {
  const dir = join(workDir, "candidates");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(workDir, "instructions.md"), renderInstructions(), "utf8");
  const files = renderCandidateFiles(
    state.to_claude.map((p) => ({ id: p.id, candidate: p.candidate, facts: p.facts, code_score: p.code_score.score })),
  );
  for (const [name, content] of files) writeFileSync(join(dir, name), content, "utf8");
}

function rejection(c: V2Identified, reasons: string[], hash: string): PlannedRejection {
  return { candidate: c, reasons, content_hash: hash };
}

function mergeUrls(canonical: string, existingAlternates: string[], c: V2Identified): string[] {
  const urls = new Set([...existingAlternates, ...c.alternate_urls]);
  if (c.canonical_url !== canonical) urls.add(c.canonical_url);
  urls.delete(canonical);
  return [...urls];
}
