import type { JobEvaluation } from "../src/claude/schemas.js";
import type { Env } from "../src/config/env.js";
import type { RawCandidate } from "../src/sources/types.js";

/** Evaluación base: oferta ideal (20 h, remoto España, tarde, formación). */
export function evaluation(overrides: Partial<JobEvaluation> = {}): JobEvaluation {
  return {
    candidate_index: 0,
    is_individual_job_offer: true,
    title: "Técnico Helpdesk Junior",
    company: "Acme Soluciones",
    location: "Remoto (España)",
    remote_type: "full_remote",
    remote_scope: "España",
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
    english_level_required: "none",
    seniority: "junior",
    technologies: ["Windows", "Linux"],
    requirements: [],
    training_info: "Plan de formación interna y mentoría",
    growth_info: null,
    summary: "Soporte a usuarios.",
    match_reasons: ["20 h semanales", "100% remoto", "Turno de tarde"],
    red_flags: [],
    assessment: { learning: 85, asir_fit: 85, role_fit: 90, technologies: 80, other: 70 },
    assessment_notes: "",
    ...overrides,
  };
}

export function rawCandidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    source: "example.com",
    url: "https://example.com/jobs/123?utm_source=x",
    title: "Técnico Helpdesk Junior",
    company: "Acme Soluciones",
    location: "Remoto",
    published_at: null,
    details: "Helpdesk 20 h, tardes, 100% remoto",
    details_origin: "full_page",
    discovered_via: "claude_web_search",
    ...overrides,
  };
}

export const testEnv: Env = {
  ANTHROPIC_API_KEY: "sk-ant-test-key-123456",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  JOBFINDER_USER_ID: "11111111-1111-4111-8111-111111111111",
  CLAUDE_MODEL: "claude-opus-5-5",
  CLAUDE_SEARCH_EFFORT: "medium",
  CLAUDE_EVAL_EFFORT: "high",
  MAX_SEARCHES_PER_BATCH: 10,
  MAX_FETCHES_PER_BATCH: 12,
  INFOJOBS_CLIENT_ID: undefined,
  INFOJOBS_CLIENT_SECRET: undefined,
};
