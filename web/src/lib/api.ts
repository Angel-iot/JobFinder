import { supabase } from "./supabase";
import type { Job, JobAction, JobStatus, SearchRun } from "./types";

const JOB_COLUMNS = [
  "id", "source", "url", "canonical_url", "alternate_urls", "title", "company", "location",
  "remote_type", "remote_scope", "remote_location_ambiguous", "employment_type", "hours_per_week",
  "schedule", "salary_min", "salary_max", "salary_currency", "salary_period", "salary_text",
  "experience_required", "education_required", "english_level", "description", "summary",
  "requirements", "technologies", "training_info", "growth_info", "match_reasons", "red_flags",
  "score", "priority", "published_at", "found_at", "last_seen_date", "status", "is_updated", "score_source",
].join(", ");

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function fetchLatestRun(): Promise<SearchRun | null> {
  const res = await supabase
    .from("search_runs")
    .select("id, run_date, status, trigger, started_at, finished_at, stats, errors")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return check(res) as SearchRun | null;
}

export async function fetchRecentRuns(limit = 7): Promise<SearchRun[]> {
  const res = await supabase
    .from("search_runs")
    .select("id, run_date, status, trigger, started_at, finished_at, stats, errors")
    .order("run_date", { ascending: false })
    .limit(limit);
  return check(res) as SearchRun[];
}

/** Ofertas vistas en la ejecución de una fecha (sin descartadas). */
export async function fetchJobsSeenOn(date: string): Promise<Job[]> {
  const res = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("last_seen_date", date)
    .neq("status", "dismissed")
    .order("score", { ascending: false });
  return check(res) as unknown as Job[];
}

export async function fetchJobsByStatus(status: JobStatus): Promise<Job[]> {
  const res = await supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("status", status)
    .order(status === "new" ? "score" : "updated_at", { ascending: false })
    .limit(500);
  return check(res) as unknown as Job[];
}

export async function countByStatus(): Promise<Record<JobStatus, number>> {
  const counts = { new: 0, saved: 0, dismissed: 0 } as Record<JobStatus, number>;
  await Promise.all(
    (Object.keys(counts) as JobStatus[]).map(async (s) => {
      const res = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", s);
      if (res.error) throw new Error(res.error.message);
      counts[s] = res.count ?? 0;
    }),
  );
  return counts;
}

export async function fetchRecentActions(limit = 10): Promise<JobAction[]> {
  const res = await supabase
    .from("job_actions")
    .select("id, job_id, action, created_at, jobs(title, company)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return check(res) as unknown as JobAction[];
}

/** El usuario solo puede cambiar el estado (RLS + privilegios por columna). */
export async function setJobStatus(id: string, status: JobStatus): Promise<void> {
  const res = await supabase.from("jobs").update({ status }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
}

export async function acknowledgeUpdate(id: string): Promise<void> {
  const res = await supabase.from("jobs").update({ is_updated: false }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
}
