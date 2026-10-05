/**
 * Estado compartido entre los pasos del workflow v2 (archivo work/state.json).
 * No contiene secretos: solo datos públicos de ofertas y métricas.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobEvaluation } from "../claude/schemas.js";
import type { IdentifiedCandidate } from "../dedup/dedup.js";
import type { ScoreResult } from "../scoring/score.js";
import type { CodeFacts } from "./facts.js";
import type { SourceName, V2Candidate } from "./types.js";

export type V2Identified = IdentifiedCandidate & V2Candidate;

export interface PreparedCandidate {
  id: string;
  candidate: V2Identified;
  facts: CodeFacts;
  code_evaluation: JobEvaluation;
  code_score: ScoreResult;
  /** Si ya existía en la BD (guardada, o nueva puntuada solo por código). */
  existing_job_id: string | null;
  existing_status: "new" | "saved" | null;
}

export interface PlannedRejection {
  candidate: V2Identified;
  reasons: string[];
  content_hash: string;
}

export type ClaudeStatus =
  | "pending"
  | "ok"
  | "partial"
  | "skipped_no_candidates"
  | "skipped_no_token"
  | "skipped_by_input"
  | "usage_limit"
  | "failed"
  | "invalid_output";

export interface V2Stats {
  pipeline: "v2";
  run_date: string;
  trigger: string;
  started_at: string;
  finished_at?: string;
  duration_s?: number;
  step_durations_s: Record<string, number>;
  per_source: Record<SourceName, { enabled: boolean; requests: number; fetched: number; candidates: number; relevant: number; errors: number; duration_ms: number }>;
  candidates_found: number;
  unique_candidates: number;
  discarded_relevance: number;
  discarded_by_filter: Record<string, number>;
  discarded_hard_filters: number;
  discarded_low_score_code: number;
  discarded_low_score_claude: number;
  discarded_by_claude_facts: number;
  skipped_dismissed: number;
  skipped_previously_rejected: number;
  already_known: number;
  passed_filters: number;
  sent_to_claude: number;
  claude_status: ClaudeStatus;
  analyzed_by_claude: number;
  claude_missing: number;
  claude_usage: Record<string, unknown> | null;
  inserted: number;
  inserted_claude: number;
  inserted_code_only: number;
  saved_updated: number;
  upgraded_to_claude: number;
  relevant_today: number;
  errors: string[];
}

export interface V2State {
  version: 2;
  run_id: string;
  run_date: string;
  attempt: number;
  stats: V2Stats;
  /** Enviados a Claude (y su puntuación de respaldo por código). */
  to_claude: PreparedCandidate[];
  /** Pasaron filtros pero superan el máximo para Claude: se guardan con nota de código. */
  code_only: PreparedCandidate[];
  rejections: PlannedRejection[];
  touches: { job_id: string; alternate_urls: string[] }[];
  fatal_error: string | null;
}

export function statePath(workDir: string) {
  return join(workDir, "state.json");
}

export function writeState(workDir: string, state: V2State) {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(statePath(workDir), JSON.stringify(state, null, 2), "utf8");
}

export function readState(workDir: string): V2State {
  return JSON.parse(readFileSync(statePath(workDir), "utf8")) as V2State;
}

export function emptyStats(runDate: string, trigger: string): V2Stats {
  const src = () => ({ enabled: false, requests: 0, fetched: 0, candidates: 0, relevant: 0, errors: 0, duration_ms: 0 });
  return {
    pipeline: "v2",
    run_date: runDate,
    trigger,
    started_at: new Date().toISOString(),
    step_durations_s: {},
    per_source: { infojobs_api: src(), adzuna: src(), himalayas: src(), remotive: src(), remoteok: src(), arbeitnow: src() },
    candidates_found: 0,
    unique_candidates: 0,
    discarded_relevance: 0,
    discarded_by_filter: {},
    discarded_hard_filters: 0,
    discarded_low_score_code: 0,
    discarded_low_score_claude: 0,
    discarded_by_claude_facts: 0,
    skipped_dismissed: 0,
    skipped_previously_rejected: 0,
    already_known: 0,
    passed_filters: 0,
    sent_to_claude: 0,
    claude_status: "pending",
    analyzed_by_claude: 0,
    claude_missing: 0,
    claude_usage: null,
    inserted: 0,
    inserted_claude: 0,
    inserted_code_only: 0,
    saved_updated: 0,
    upgraded_to_claude: 0,
    relevant_today: 0,
    errors: [],
  };
}
