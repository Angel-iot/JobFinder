/**
 * Valida la migración de Supabase en un Postgres embebido (PGlite):
 * sintaxis, restricciones, triggers de historial y Row Level Security.
 * Se simulan los roles y auth.uid() de Supabase.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261005000000_init.sql", import.meta.url), "utf8");
const MIGRATION_V2 = readFileSync(new URL("../../supabase/migrations/20261006000000_v2_score_source.sql", import.meta.url), "utf8");
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

let db: PGlite;

async function asUser(userId: string | null, role: "authenticated" | "anon", sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); set role ${role};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

async function insertJob(userId: string, url: string) {
  const res = await db.query<{ id: string }>(
    `insert into public.jobs (user_id, source, url, canonical_url, fingerprint, content_hash, title, score, first_seen_date, last_seen_date)
     values ($1, 'linkedin', $2, $2, 'fp-' || $2, 'h', 'Helpdesk', 80, '2026-10-05', '2026-10-05') returning id`,
    [userId, url],
  );
  return res.rows[0]!.id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_V2);
  await db.query("insert into auth.users (id) values ($1), ($2)", [USER_A, USER_B]);
}, 60_000);

describe("schema de Supabase", () => {
  it("crea las tablas", async () => {
    const res = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(res.rows.map((r) => r.table_name)).toEqual(["job_actions", "job_rejections", "jobs", "search_runs"]);
  });

  it("impide URLs canónicas duplicadas para el mismo usuario", async () => {
    await insertJob(USER_A, "https://dup.example/1");
    await expect(insertJob(USER_A, "https://dup.example/1")).rejects.toThrow(/duplicate key/);
    await expect(insertJob(USER_B, "https://dup.example/1")).resolves.toBeTruthy();
  });

  it("solo una ejecución por usuario y día", async () => {
    await db.query("insert into public.search_runs (user_id, run_date) values ($1, '2026-10-05')", [USER_A]);
    await expect(
      db.query("insert into public.search_runs (user_id, run_date) values ($1, '2026-10-05')", [USER_A]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("rechaza estados no válidos", async () => {
    const id = await insertJob(USER_A, "https://state.example/1");
    await expect(db.query("update public.jobs set status = 'applied' where id = $1", [id])).rejects.toThrow(/check/);
  });
});

describe("Row Level Security", () => {
  it("cada usuario solo ve sus ofertas", async () => {
    await insertJob(USER_A, "https://rls.example/a");
    await insertJob(USER_B, "https://rls.example/b");
    const res = await asUser(USER_A, "authenticated", "select user_id from public.jobs");
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((r) => (r as { user_id: string }).user_id === USER_A)).toBe(true);
  });

  it("anon no puede leer nada", async () => {
    await expect(asUser(null, "anon", "select * from public.jobs")).rejects.toThrow(/permission denied/);
  });

  it("el usuario puede cambiar el estado y queda en el historial", async () => {
    const id = await insertJob(USER_A, "https://rls.example/save");
    await asUser(USER_A, "authenticated", "update public.jobs set status = 'saved' where id = $1", [id]);
    await asUser(USER_A, "authenticated", "update public.jobs set status = 'dismissed' where id = $1", [id]);
    await asUser(USER_A, "authenticated", "update public.jobs set status = 'new' where id = $1", [id]);
    const actions = await asUser(
      USER_A,
      "authenticated",
      "select action from public.job_actions where job_id = $1 order by created_at, action",
      [id],
    );
    expect(actions.rows.map((r) => (r as { action: string }).action).sort()).toEqual(["dismissed", "saved", "undismissed"]);
    const job = await db.query<{ status_changed_at: string | null }>("select status_changed_at from public.jobs where id = $1", [id]);
    expect(job.rows[0]!.status_changed_at).not.toBeNull();
  });

  it("el usuario NO puede modificar el contenido de una oferta", async () => {
    const id = await insertJob(USER_A, "https://rls.example/content");
    await expect(
      asUser(USER_A, "authenticated", "update public.jobs set score = 100 where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("el usuario NO puede insertar ni borrar ofertas", async () => {
    await expect(
      asUser(
        USER_A,
        "authenticated",
        `insert into public.jobs (user_id, source, url, canonical_url, fingerprint, content_hash, title, score, first_seen_date, last_seen_date)
         values ('${USER_A}', 'x', 'u', 'u', 'f', 'h', 't', 1, now(), now())`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(USER_A, "authenticated", "delete from public.jobs")).rejects.toThrow(/permission denied/);
  });

  it("el usuario no puede cambiar ofertas de otro usuario", async () => {
    const id = await insertJob(USER_B, "https://rls.example/other");
    const res = await asUser(USER_A, "authenticated", "update public.jobs set status = 'dismissed' where id = $1", [id]);
    expect(res.affectedRows).toBe(0);
    const check = await db.query<{ status: string }>("select status from public.jobs where id = $1", [id]);
    expect(check.rows[0]!.status).toBe("new");
  });

  it("el usuario no puede escribir el historial directamente", async () => {
    const id = await insertJob(USER_A, "https://rls.example/history");
    await expect(
      asUser(USER_A, "authenticated", `insert into public.job_actions (job_id, user_id, action) values ($1, '${USER_A}', 'saved')`, [id]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("migración v2 (score_source)", () => {
  it("las filas existentes quedan como 'claude' y solo se admite claude/code", async () => {
    const id = await insertJob(USER_A, "https://v2.example/1");
    const row = await db.query<{ score_source: string; code_score: number | null }>("select score_source, code_score from public.jobs where id = $1", [id]);
    expect(row.rows[0]).toEqual({ score_source: "claude", code_score: null });
    await expect(db.query("update public.jobs set score_source = 'magic' where id = $1", [id])).rejects.toThrow(/check/);
    await db.query("update public.jobs set score_source = 'code', code_score = 55 where id = $1", [id]);
  });

  it("el usuario puede leer score_source pero no modificarlo", async () => {
    const id = await insertJob(USER_A, "https://v2.example/2");
    const res = await asUser(USER_A, "authenticated", "select score_source from public.jobs where id = $1", [id]);
    expect(res.rows).toHaveLength(1);
    await expect(
      asUser(USER_A, "authenticated", "update public.jobs set score_source = 'code' where id = $1", [id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("la migración v2 es re-ejecutable", async () => {
    await expect(db.exec(MIGRATION_V2)).resolves.toBeDefined();
  });
});
