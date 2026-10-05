export type JobStatus = "new" | "saved" | "dismissed";
export type Priority = "high" | "interesting" | "other";

/** Fila de public.jobs tal como la lee el frontend. */
export interface Job {
  id: string;
  source: string;
  url: string;
  canonical_url: string;
  alternate_urls: string[];
  title: string;
  company: string | null;
  location: string | null;
  remote_type: "full_remote" | "hybrid" | "onsite" | "unknown";
  remote_scope: string | null;
  remote_location_ambiguous: boolean;
  employment_type: "part_time" | "full_time" | "internship" | "freelance" | "unknown";
  hours_per_week: number | null;
  schedule: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: "hour" | "month" | "year" | null;
  salary_text: string | null;
  experience_required: string | null;
  education_required: string | null;
  english_level: string;
  description: string | null;
  summary: string | null;
  requirements: string[];
  technologies: string[];
  training_info: string | null;
  growth_info: string | null;
  match_reasons: string[];
  red_flags: string[];
  score: number;
  priority: Priority;
  published_at: string | null;
  found_at: string;
  last_seen_date: string;
  status: JobStatus;
  is_updated: boolean;
  /** v2: 'claude' = analizada por Claude; 'code' = solo reglas (Claude no disponible). */
  score_source?: "claude" | "code";
}

export interface SearchRun {
  id: string;
  run_date: string;
  status: "running" | "success" | "partial" | "failed";
  trigger: string;
  started_at: string;
  finished_at: string | null;
  stats: Partial<{
    searches: number;
    candidates_found: number;
    unique_candidates: number;
    inserted: number;
    relevant_today: number;
    discarded_hard_filters: number;
    discarded_low_score: number;
  }>;
  errors: string[];
}

export interface JobAction {
  id: string;
  job_id: string;
  action: "saved" | "dismissed" | "undismissed" | "unsaved";
  created_at: string;
  jobs: { title: string; company: string | null } | null;
}
