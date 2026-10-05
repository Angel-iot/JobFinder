/**
 * Acceso a datos de la v2: reutiliza el repositorio de la v1 y añade lo que
 * necesita la v2 (saber si una oferta se puntuó con Claude o solo por código).
 */
import type { EnvV2 } from "./env.js";
import type { Env } from "../config/env.js";
import { InMemoryRepository, type JobRow, type JobsRepository, type KnownJob } from "../storage/repository.js";
import { SupabaseRepository } from "../storage/supabaseRepository.js";

export type ScoreSource = "claude" | "code";

export interface KnownJobV2 extends KnownJob {
  score_source: ScoreSource;
}

export interface JobRowV2 extends JobRow {
  score_source: ScoreSource;
  code_score: number | null;
}

export interface JobsRepositoryV2 extends JobsRepository {
  loadKnownJobsV2(userId: string): Promise<KnownJobV2[]>;
}

export class SupabaseRepositoryV2 extends SupabaseRepository implements JobsRepositoryV2 {
  constructor(env: EnvV2) {
    super(env as unknown as Env);
  }

  async loadKnownJobsV2(userId: string): Promise<KnownJobV2[]> {
    const out: KnownJobV2[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from("jobs")
        .select("id, status, canonical_url, source, external_id, fingerprint, alternate_urls, content_hash, score_source")
        .eq("user_id", userId)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Supabase: error al leer jobs (${error.code ?? "?"}): ${error.message}`);
      out.push(...((data ?? []) as KnownJobV2[]));
      if (!data || data.length < PAGE) return out;
    }
  }
}

export class InMemoryRepositoryV2 extends InMemoryRepository implements JobsRepositoryV2 {
  async loadKnownJobsV2(): Promise<KnownJobV2[]> {
    return this.jobs.map((j) => ({
      id: j.id,
      status: j.status,
      canonical_url: j.canonical_url,
      source: j.source,
      external_id: j.external_id,
      fingerprint: j.fingerprint,
      alternate_urls: j.alternate_urls,
      content_hash: j.content_hash,
      score_source: ((j as unknown as { score_source?: ScoreSource }).score_source ?? "claude") as ScoreSource,
    }));
  }
}
