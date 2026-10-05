import type { ClaudeAnalysis } from "../../src/v2/analysisSchema.js";
import type { EnvV2 } from "../../src/v2/env.js";
import { emptyHints, type SourceHints, type SourceName, type SourceResult, type V2Candidate } from "../../src/v2/types.js";

export function v2Env(workDir: string): EnvV2 {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
    JOBFINDER_USER_ID: "11111111-1111-4111-8111-111111111111",
    MAX_CLAUDE_CANDIDATES: 30,
    WORK_DIR: workDir,
    INFOJOBS_CLIENT_ID: undefined,
    INFOJOBS_CLIENT_SECRET: undefined,
    ADZUNA_APP_ID: undefined,
    ADZUNA_APP_KEY: undefined,
  };
}

export function cand(overrides: Partial<Omit<V2Candidate, "hints">> & { hints?: Partial<SourceHints> } = {}): V2Candidate {
  const { hints, ...rest } = overrides;
  return {
    api: "himalayas",
    source: "himalayas.app",
    url: "https://himalayas.app/companies/acme/jobs/helpdesk-junior",
    title: "IT Helpdesk Technician",
    company: "Acme",
    location: "Spain",
    published_at: "2026-10-04T10:00:00Z",
    details: "Part-time 20 hours per week. Afternoon shift from 16:00 to 20:00. Windows, Microsoft 365 and Active Directory. Mentoring and training program.",
    details_origin: "official_api",
    discovered_via: "official_api",
    ...rest,
    hints: emptyHints({ remote_board: true, spain_allowed_by_query: true, location_restriction: "Spain", ...hints }),
  };
}

export function sourceResult(source: SourceName, candidates: V2Candidate[], extra: Partial<SourceResult> = {}): SourceResult {
  return { source, enabled: true, requests: 1, fetched: candidates.length, candidates, errors: [], duration_ms: 5, ...extra };
}

export function analysis(id: string, overrides: Partial<ClaudeAnalysis> = {}): ClaudeAnalysis {
  return {
    id,
    is_individual_job_offer: true,
    title: "IT Helpdesk Technician",
    company: "Acme",
    location: "Remote (Spain)",
    remote_type: "full_remote",
    remote_scope: "Spain",
    remote_allows_spain: "yes",
    employment_type: "part_time",
    hours_per_week: 20,
    schedule: "16:00-20:00",
    schedule_start: "16:00",
    schedule_end: "20:00",
    requires_morning_availability: "no",
    afternoon_schedule_confirmed: true,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    salary_text: null,
    experience_required: null,
    experience_years_min: null,
    education_required: null,
    english_level_required: "basic",
    seniority: "junior",
    technologies: ["Windows", "Microsoft 365"],
    requirements: [],
    training_info: "Programa de mentoría",
    growth_info: null,
    summary: "Soporte N1 por las tardes.",
    match_reasons: ["20 h semanales", "Turno de tarde", "Mentoría"],
    red_flags: ["No publica salario"],
    assessment: { learning: 85, asir_fit: 85, role_fit: 90, technologies: 80, other: 70 },
    assessment_notes: "",
    score: 91,
    score_rationale: "Cumple horario, jornada y modalidad, con mentoría.",
    ...overrides,
  };
}

/** Archivo de ejecución mínimo con la forma que deja claude-code-action. */
export function executionMessages(structured: unknown, resultOverrides: Record<string, unknown> = {}) {
  return [
    { type: "system", subtype: "init", model: "claude-sonnet-5-5", session_id: "s1" },
    { type: "assistant", message: { content: [{ type: "text", text: "..." }] } },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 4,
      duration_ms: 42000,
      total_cost_usd: 0.31,
      usage: { input_tokens: 21000, output_tokens: 5200, cache_read_input_tokens: 12000, cache_creation_input_tokens: 3000 },
      permission_denials: [],
      structured_output: structured,
      ...resultOverrides,
    },
  ];
}
