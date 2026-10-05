/**
 * PASO 3 del workflow v2 (sin IA, sin Anthropic):
 * resultado de Claude (si lo hay) → validación → filtros duros otra vez sobre
 * los datos de Claude → Supabase. Si Claude falló o no se ejecutó, cada oferta
 * se guarda con la puntuación calculada SOLO por código.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobEvaluation } from "../claude/schemas.js";
import { preferences } from "../config/preferences.js";
import { errorMessage, type Logger } from "../lib/logger.js";
import { mergeRedFlags, priorityFor, scoreJob, type ScoreResult } from "../scoring/score.js";
import type { RunStatus } from "../storage/repository.js";
import type { ClaudeAnalysis } from "./analysisSchema.js";
import { codeContentHash } from "./collect.js";
import { hardFiltersV2 } from "./codeEvaluation.js";
import type { EnvV2 } from "./env.js";
import type { ExecutionSummary } from "./execution.js";
import type { JobRowV2, JobsRepositoryV2, ScoreSource } from "./repository.js";
import { readState, type ClaudeStatus, type PreparedCandidate, type V2Identified, type V2State, type V2Stats } from "./state.js";

export interface StoreDeps {
  env: EnvV2;
  repo: JobsRepositoryV2;
  log: Logger;
}

export interface StoreOptions {
  /** Resumen del archivo de ejecución de Claude (o null si el paso no se ejecutó). */
  execution: ExecutionSummary | null;
  /** Motivo por el que no se ejecutó Claude, si aplica. */
  claudeSkipped: Extract<ClaudeStatus, "skipped_no_token" | "skipped_by_input" | "skipped_no_candidates"> | null;
  state?: V2State;
}

export interface StoreResult {
  status: RunStatus;
  stats: V2Stats;
}

export async function store(deps: StoreDeps, opts: StoreOptions): Promise<StoreResult> {
  const { env, repo, log } = deps;
  const t0 = Date.now();
  const state = opts.state ?? readState(env.WORK_DIR);
  const stats = state.stats;
  const userId = env.JOBFINDER_USER_ID;
  const nowIso = new Date().toISOString();

  // Resultado de Claude
  const analyses = new Map<string, ClaudeAnalysis>();
  if (state.to_claude.length === 0) {
    stats.claude_status = "skipped_no_candidates";
  } else if (opts.claudeSkipped) {
    stats.claude_status = opts.claudeSkipped;
  } else if (opts.execution) {
    stats.claude_usage = opts.execution.usage as Record<string, unknown> | null;
    const ids = new Set(state.to_claude.map((p) => p.id));
    for (const a of opts.execution.analyses) if (ids.has(a.id) && !analyses.has(a.id)) analyses.set(a.id, a);
    stats.analyzed_by_claude = analyses.size;
    stats.claude_missing = state.to_claude.length - analyses.size;
    stats.claude_status =
      opts.execution.status === "ok" ? (analyses.size === state.to_claude.length ? "ok" : "partial") : opts.execution.status === "missing" ? "failed" : opts.execution.status;
    if (opts.execution.error) stats.errors.push(`[claude] ${opts.execution.error}`);
    if (opts.execution.invalid_items) stats.errors.push(`[claude] ${opts.execution.invalid_items} análisis con formato inválido descartados`);
  } else {
    stats.claude_status = "failed";
    stats.errors.push("[claude] El paso de Claude no produjo resultado");
  }
  log.info("Resultado de Claude", { status: stats.claude_status, analyzed: stats.analyzed_by_claude, sent: stats.sent_to_claude });

  const save = async (fn: () => Promise<void>, what: string) => {
    try {
      await fn();
    } catch (err) {
      stats.errors.push(`[supabase] ${what}: ${errorMessage(err)}`);
      log.error("Error de Supabase", { what, error: errorMessage(err) });
    }
  };

  if (!state.fatal_error) {
    for (const p of state.to_claude) {
      const a = analyses.get(p.id);
      await save(() => (a ? persistClaude(deps, state, p, a, nowIso) : persistCode(deps, state, p, nowIso)), p.candidate.canonical_url);
    }
    for (const p of state.code_only) await save(() => persistCode(deps, state, p, nowIso), p.candidate.canonical_url);
    for (const r of state.rejections) {
      await save(
        () =>
          repo.upsertRejection({
            user_id: userId,
            canonical_url: r.candidate.canonical_url,
            fingerprint: r.candidate.fingerprint,
            content_hash: r.content_hash,
            source: r.candidate.source,
            url: r.candidate.url,
            title: r.candidate.title,
            company: r.candidate.company,
            reasons: r.reasons,
            last_seen_at: nowIso,
          }),
        `descarte ${r.candidate.canonical_url}`,
      );
    }
    for (const t of state.touches) {
      await save(
        () => repo.touchJob(t.job_id, { last_seen_at: nowIso, last_seen_date: state.run_date, last_run_id: uuidOrNull(state.run_id), alternate_urls: t.alternate_urls }),
        `actualizar ${t.job_id}`,
      );
    }
  }

  stats.relevant_today = stats.inserted + stats.saved_updated + stats.upgraded_to_claude + stats.already_known;
  stats.step_durations_s.store = Math.round((Date.now() - t0) / 1000);
  stats.finished_at = new Date().toISOString();
  stats.duration_s = Math.round((Date.parse(stats.finished_at) - Date.parse(stats.started_at)) / 1000);

  const status = decideStatus(state);
  await save(() => repo.finishRun(state.run_id, status, stats as unknown as Record<string, unknown>, stats.errors.slice(0, 100)), "cerrar ejecución");
  writeFileSync(join(env.WORK_DIR, "metrics.json"), JSON.stringify({ status, ...stats }, null, 2), "utf8");
  log.info("Ejecución v2 terminada", { status, inserted: stats.inserted, claude_status: stats.claude_status, duration_s: stats.duration_s, errors: stats.errors.length });
  return { status, stats };
}

function decideStatus(state: V2State): RunStatus {
  const s = state.stats;
  if (state.fatal_error) return "failed";
  const enabled = Object.values(s.per_source).filter((x) => x.enabled);
  if (enabled.length > 0 && enabled.every((x) => x.fetched === 0 && x.errors > 0)) return "failed";
  const claudeOk = ["ok", "skipped_no_candidates", "skipped_by_input"].includes(s.claude_status);
  return s.errors.length === 0 && claudeOk ? "success" : "partial";
}

// ------------------------------------------------------------- persistencia

async function persistClaude(deps: StoreDeps, state: V2State, p: PreparedCandidate, a: ClaudeAnalysis, nowIso: string) {
  const { repo, env } = deps;
  const stats = state.stats;
  const evaluation: JobEvaluation = { ...a, candidate_index: 0 };
  // Los filtros duros vuelven a aplicarse en código sobre lo que ha extraído Claude.
  const filter = hardFiltersV2(evaluation, p.facts.other_language_required);
  const structural = scoreJob(evaluation); // avisos coherentes con los datos de Claude
  const score = clampScore(a.score);
  const row = buildRowV2(env.JOBFINDER_USER_ID, state, p.candidate, evaluation, {
    score,
    priority: priorityFor(score, evaluation),
    reasons: [a.score_rationale],
    breakdown: { claude_assessment: a.assessment, claude_notes: a.assessment_notes, code_score: p.code_score.score, code_breakdown: p.code_score.breakdown },
    warnings: structural.warnings,
    source: "claude",
    codeScore: p.code_score.score,
    hash: codeContentHash(p.candidate, p.code_evaluation),
    nowIso,
  });

  if (p.existing_job_id) {
    const { first_seen_date: _f, found_at: _fa, ...patch } = row;
    if (!filter.passed) patch.red_flags = mergeRedFlags(filter.reasons.map((r) => `Ya no cumple: ${r}`), patch.red_flags);
    await repo.updateJob(p.existing_job_id, { ...patch, ...(p.existing_status === "saved" ? { is_updated: true } : {}) });
    if (p.existing_status === "saved") stats.saved_updated++;
    else stats.upgraded_to_claude++;
    return;
  }
  if (!filter.passed) {
    stats.discarded_by_claude_facts++;
    await rejectionFor(deps, p.candidate, filter.reasons.map((r) => `${r} (según el análisis de Claude)`), row.content_hash, nowIso);
    return;
  }
  if (score < preferences.minScoreToStore) {
    stats.discarded_low_score_claude++;
    await rejectionFor(deps, p.candidate, [`Puntuación baja (${score}, Claude)`], row.content_hash, nowIso);
    return;
  }
  await repo.insertJob(row);
  stats.inserted++;
  stats.inserted_claude++;
}

async function persistCode(deps: StoreDeps, state: V2State, p: PreparedCandidate, nowIso: string) {
  const { repo, env } = deps;
  const stats = state.stats;
  const hash = codeContentHash(p.candidate, p.code_evaluation);

  if (p.existing_job_id) {
    // Sin análisis nuevo: se mantiene la ficha y se marca como vista hoy (y "actualizada" si cambió).
    await repo.touchJob(p.existing_job_id, {
      last_seen_at: nowIso,
      last_seen_date: state.run_date,
      last_run_id: uuidOrNull(state.run_id),
      alternate_urls: p.candidate.alternate_urls,
    });
    if (p.existing_status === "saved") await repo.updateJob(p.existing_job_id, { is_updated: true, content_hash: hash });
    stats.already_known++;
    return;
  }
  if (p.code_score.score < preferences.minScoreToStore) {
    stats.discarded_low_score_code++;
    await rejectionFor(deps, p.candidate, [`Puntuación baja por código (${p.code_score.score})`], hash, nowIso);
    return;
  }
  const row = buildRowV2(env.JOBFINDER_USER_ID, state, p.candidate, p.code_evaluation, {
    score: p.code_score.score,
    priority: p.code_score.priority,
    reasons: p.code_score.reasons,
    breakdown: { ...p.code_score.breakdown, code_evidence: p.facts.evidence },
    warnings: p.code_score.warnings,
    source: "code",
    codeScore: p.code_score.score,
    hash,
    nowIso,
  });
  await repo.insertJob(row);
  stats.inserted++;
  stats.inserted_code_only++;
}

function rejectionFor(deps: StoreDeps, c: V2Identified, reasons: string[], hash: string, nowIso: string) {
  return deps.repo.upsertRejection({
    user_id: deps.env.JOBFINDER_USER_ID,
    canonical_url: c.canonical_url,
    fingerprint: c.fingerprint,
    content_hash: hash,
    source: c.source,
    url: c.url,
    title: c.title,
    company: c.company,
    reasons,
    last_seen_at: nowIso,
  });
}

interface ScoreInfo {
  score: number;
  priority: ScoreResult["priority"];
  reasons: string[];
  breakdown: Record<string, unknown>;
  warnings: string[];
  source: ScoreSource;
  codeScore: number;
  hash: string;
  nowIso: string;
}

export function buildRowV2(userId: string, state: V2State, c: V2Identified, e: JobEvaluation, s: ScoreInfo): JobRowV2 {
  return {
    user_id: userId,
    source: c.source,
    external_id: c.external_id,
    url: c.url,
    canonical_url: c.canonical_url,
    alternate_urls: c.alternate_urls,
    fingerprint: c.fingerprint,
    content_hash: s.hash,
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
    summary: e.summary || null,
    requirements: e.requirements,
    technologies: e.technologies,
    training_info: e.training_info,
    growth_info: e.growth_info,
    match_reasons: e.match_reasons,
    red_flags: mergeRedFlags(e.red_flags, s.warnings),
    score: s.score,
    score_reasons: s.reasons,
    score_breakdown: { ...s.breakdown, source_api: c.api, details_origin: c.details_origin },
    priority: s.priority,
    published_at: toIsoOrNull(c.published_at),
    found_at: s.nowIso,
    last_seen_at: s.nowIso,
    first_seen_date: state.run_date,
    last_seen_date: state.run_date,
    last_run_id: uuidOrNull(state.run_id),
    score_source: s.source,
    code_score: s.codeScore,
  };
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toIsoOrNull(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function uuidOrNull(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
