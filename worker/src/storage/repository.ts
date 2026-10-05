/**
 * Acceso a datos. La implementación real usa Supabase (clave secreta, solo en
 * el worker). La implementación en memoria sirve para --dry-run y tests.
 */

export type JobStatus = "new" | "saved" | "dismissed";
export type RunStatus = "running" | "success" | "partial" | "failed";

export interface KnownJob {
  id: string;
  status: JobStatus;
  canonical_url: string;
  source: string;
  external_id: string | null;
  fingerprint: string;
  alternate_urls: string[];
  content_hash: string;
}

export interface KnownRejection {
  canonical_url: string;
  fingerprint: string;
}

/** Fila de public.jobs (columnas que escribe el worker). */
export interface JobRow {
  user_id: string;
  source: string;
  external_id: string | null;
  url: string;
  canonical_url: string;
  alternate_urls: string[];
  fingerprint: string;
  content_hash: string;
  title: string;
  company: string | null;
  location: string | null;
  remote_type: string;
  remote_scope: string | null;
  remote_location_ambiguous: boolean;
  employment_type: string;
  hours_per_week: number | null;
  schedule: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_text: string | null;
  experience_required: string | null;
  experience_years_min: number | null;
  education_required: string | null;
  english_level: string;
  seniority: string;
  description: string | null;
  summary: string | null;
  requirements: string[];
  technologies: string[];
  training_info: string | null;
  growth_info: string | null;
  match_reasons: string[];
  red_flags: string[];
  score: number;
  score_reasons: string[];
  score_breakdown: Record<string, unknown>;
  priority: string;
  published_at: string | null;
  found_at?: string;
  last_seen_at: string;
  first_seen_date: string;
  last_seen_date: string;
  last_run_id: string | null;
}

export interface RejectionRow {
  user_id: string;
  canonical_url: string;
  fingerprint: string;
  content_hash: string;
  source: string;
  url: string;
  title: string;
  company: string | null;
  reasons: string[];
  last_seen_at: string;
}

export interface RunRecord {
  id: string;
  status: RunStatus;
  attempts: number;
}

export type StartRunResult =
  | { started: true; run: RunRecord }
  | { started: false; reason: string; existing: RunRecord };

export interface JobsRepository {
  startRun(userId: string, runDate: string, trigger: string, opts: { force: boolean }): Promise<StartRunResult>;
  finishRun(runId: string, status: RunStatus, stats: Record<string, unknown>, errors: string[]): Promise<void>;
  loadKnownJobs(userId: string): Promise<KnownJob[]>;
  loadRejections(userId: string): Promise<KnownRejection[]>;
  insertJob(row: JobRow): Promise<void>;
  updateJob(id: string, patch: Partial<JobRow> & { is_updated?: boolean }): Promise<void>;
  touchJob(id: string, patch: { last_seen_at: string; last_seen_date: string; last_run_id: string | null; alternate_urls?: string[] }): Promise<void>;
  upsertRejection(row: RejectionRow): Promise<void>;
}

/** Tras cuánto tiempo una ejecución "running" se considera colgada y se puede reintentar. */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000;

export class InMemoryRepository implements JobsRepository {
  runs = new Map<string, RunRecord & { run_date: string; started_at: number; stats?: Record<string, unknown>; errors?: string[] }>();
  jobs: (JobRow & { id: string; status: JobStatus; is_updated: boolean })[] = [];
  rejections: RejectionRow[] = [];
  private seq = 0;

  async startRun(userId: string, runDate: string, _trigger: string, opts: { force: boolean }): Promise<StartRunResult> {
    const key = `${userId}:${runDate}`;
    const existing = this.runs.get(key);
    if (existing && !opts.force) {
      if (existing.status === "success" || existing.status === "partial") {
        return { started: false, reason: `La búsqueda del ${runDate} ya se ejecutó (${existing.status})`, existing };
      }
      if (existing.status === "running" && Date.now() - existing.started_at < STALE_RUN_MS) {
        return { started: false, reason: `Ya hay una búsqueda del ${runDate} en curso`, existing };
      }
    }
    const run = {
      id: existing?.id ?? `run-${++this.seq}`,
      status: "running" as const,
      attempts: (existing?.attempts ?? 0) + 1,
      run_date: runDate,
      started_at: Date.now(),
    };
    this.runs.set(key, run);
    return { started: true, run };
  }

  async finishRun(runId: string, status: RunStatus, stats: Record<string, unknown>, errors: string[]) {
    for (const run of this.runs.values()) {
      if (run.id === runId) Object.assign(run, { status, stats, errors });
    }
  }

  async loadKnownJobs(): Promise<KnownJob[]> {
    return this.jobs.map((j) => ({
      id: j.id,
      status: j.status,
      canonical_url: j.canonical_url,
      source: j.source,
      external_id: j.external_id,
      fingerprint: j.fingerprint,
      alternate_urls: j.alternate_urls,
      content_hash: j.content_hash,
    }));
  }

  async loadRejections(): Promise<KnownRejection[]> {
    return this.rejections.map((r) => ({ canonical_url: r.canonical_url, fingerprint: r.fingerprint }));
  }

  async insertJob(row: JobRow) {
    if (this.jobs.some((j) => j.canonical_url === row.canonical_url)) throw new Error("duplicate canonical_url");
    this.jobs.push({ ...row, id: `job-${++this.seq}`, status: "new", is_updated: false });
  }

  async updateJob(id: string, patch: Partial<JobRow> & { is_updated?: boolean }) {
    const job = this.jobs.find((j) => j.id === id);
    if (job) Object.assign(job, patch);
  }

  async touchJob(id: string, patch: { last_seen_at: string; last_seen_date: string; last_run_id: string | null; alternate_urls?: string[] }) {
    await this.updateJob(id, patch);
  }

  async upsertRejection(row: RejectionRow) {
    const idx = this.rejections.findIndex((r) => r.canonical_url === row.canonical_url);
    if (idx === -1) this.rejections.push(row);
    else this.rejections[idx] = row;
  }
}
