import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import {
  STALE_RUN_MS,
  type JobRow,
  type JobsRepository,
  type KnownJob,
  type KnownRejection,
  type RejectionRow,
  type RunRecord,
  type RunStatus,
  type StartRunResult,
} from "./repository.js";

const PAGE = 1000;

export class SupabaseRepository implements JobsRepository {
  protected readonly db: SupabaseClient;

  constructor(env: Env) {
    // Clave secreta: omite RLS. Solo se usa aquí, en el worker.
    this.db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  async startRun(userId: string, runDate: string, trigger: string, opts: { force: boolean }): Promise<StartRunResult> {
    const { data: existing, error } = await this.db
      .from("search_runs")
      .select("id, status, attempts, started_at")
      .eq("user_id", userId)
      .eq("run_date", runDate)
      .maybeSingle();
    if (error) throw supabaseError("leer search_runs", error);

    if (!existing) {
      const { data, error: insertError } = await this.db
        .from("search_runs")
        .insert({ user_id: userId, run_date: runDate, trigger, status: "running" })
        .select("id, status, attempts")
        .single();
      if (insertError) {
        // 23505 = otra ejecución insertó la fila a la vez (unique user_id+run_date).
        if (insertError.code === "23505") {
          return { started: false, reason: "Otra ejecución empezó a la vez", existing: { id: "", status: "running", attempts: 1 } };
        }
        throw supabaseError("crear search_run", insertError);
      }
      return { started: true, run: data as RunRecord };
    }

    const record: RunRecord = { id: existing.id, status: existing.status, attempts: existing.attempts };
    if (!opts.force) {
      if (existing.status === "success" || existing.status === "partial") {
        return { started: false, reason: `La búsqueda del ${runDate} ya se ejecutó (${existing.status})`, existing: record };
      }
      if (existing.status === "running" && Date.now() - new Date(existing.started_at).getTime() < STALE_RUN_MS) {
        return { started: false, reason: `Ya hay una búsqueda del ${runDate} en curso`, existing: record };
      }
    }

    // Reintento (fallida, colgada o --force). La condición sobre status evita carreras.
    const { data, error: updateError } = await this.db
      .from("search_runs")
      .update({
        status: "running",
        trigger,
        attempts: existing.attempts + 1,
        started_at: new Date().toISOString(),
        finished_at: null,
        errors: [],
      })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id, status, attempts")
      .maybeSingle();
    if (updateError) throw supabaseError("reiniciar search_run", updateError);
    if (!data) return { started: false, reason: "Otra ejecución tomó el control", existing: record };
    return { started: true, run: data as RunRecord };
  }

  async finishRun(runId: string, status: RunStatus, stats: Record<string, unknown>, errors: string[]) {
    const { error } = await this.db
      .from("search_runs")
      .update({ status, stats, errors, finished_at: new Date().toISOString() })
      .eq("id", runId);
    if (error) throw supabaseError("cerrar search_run", error);
  }

  async loadKnownJobs(userId: string): Promise<KnownJob[]> {
    return this.selectAll<KnownJob>(
      "jobs",
      "id, status, canonical_url, source, external_id, fingerprint, alternate_urls, content_hash",
      userId,
    );
  }

  async loadRejections(userId: string): Promise<KnownRejection[]> {
    return this.selectAll<KnownRejection>("job_rejections", "canonical_url, fingerprint", userId);
  }

  async insertJob(row: JobRow) {
    const { error } = await this.db.from("jobs").insert(row);
    if (error) throw supabaseError("insertar oferta", error);
  }

  async updateJob(id: string, patch: Partial<JobRow> & { is_updated?: boolean }) {
    const { error } = await this.db.from("jobs").update(patch).eq("id", id);
    if (error) throw supabaseError("actualizar oferta", error);
  }

  async touchJob(id: string, patch: { last_seen_at: string; last_seen_date: string; last_run_id: string | null; alternate_urls?: string[] }) {
    await this.updateJob(id, patch);
  }

  async upsertRejection(row: RejectionRow) {
    const { error } = await this.db.from("job_rejections").upsert(row, { onConflict: "user_id,canonical_url" });
    if (error) throw supabaseError("guardar descarte", error);
  }

  private async selectAll<T>(table: string, columns: string, userId: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from(table)
        .select(columns)
        .eq("user_id", userId)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw supabaseError(`leer ${table}`, error);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return out;
    }
  }
}

function supabaseError(action: string, error: { message: string; code?: string }) {
  return new Error(`Supabase: error al ${action}${error.code ? ` (${error.code})` : ""}: ${error.message}`);
}
