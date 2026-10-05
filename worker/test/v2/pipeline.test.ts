import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Logger } from "../../src/lib/logger.js";
import { collect } from "../../src/v2/collect.js";
import { summarizeExecution } from "../../src/v2/execution.js";
import { InMemoryRepositoryV2 } from "../../src/v2/repository.js";
import { store } from "../../src/v2/store.js";
import type { V2Candidate } from "../../src/v2/types.js";
import { analysis, cand, executionMessages, sourceResult, v2Env } from "./fixtures.js";

const log = new Logger();
log.info = () => {};
log.warn = () => {};
log.error = () => {};

const offers = {
  ideal: cand(),
  fullTime: cand({ url: "https://himalayas.app/companies/b/jobs/1", company: "Beta", title: "IT Support Specialist", details: "Full-time, 40 hours per week. Windows tickets hardware." }),
  hybrid: cand({ url: "https://himalayas.app/companies/g/jobs/2", company: "Gamma", title: "Service Desk Analyst", details: "Hybrid: 2 days in the office" }),
  writer: cand({ url: "https://himalayas.app/companies/w/jobs/3", company: "Words", title: "Freelance Copywriter", details: "Write blog posts" }),
  vague: cand({ url: "https://himalayas.app/companies/v/jobs/4", company: "Vague", title: "Helpdesk Technician", details: "Support our users with Windows issues." }),
};

function setup(found: V2Candidate[] = Object.values(offers)) {
  const workDir = mkdtempSync(join(tmpdir(), "jobfinder-v2-"));
  const env = v2Env(workDir);
  const repo = new InMemoryRepositoryV2();
  const deps = { env, repo, log, fetchSources: async () => [sourceResult("himalayas", found), sourceResult("remotive", [])] };
  return { workDir, env, repo, deps };
}

async function runDay(s: ReturnType<typeof setup>, date: string, claude: (ids: string[]) => ReturnType<typeof summarizeExecution> | null, skip: "skipped_no_token" | null = null) {
  const c = await collect(s.deps, { runDate: date, trigger: "test", force: false });
  if (!c.started) return { collect: c, store: null };
  const ids = c.state.to_claude.map((p) => p.id);
  const execution = skip ? null : claude(ids);
  const st = await store({ env: s.env, repo: s.repo, log }, { execution, claudeSkipped: skip, state: c.state });
  return { collect: c, store: st };
}

const claudeOk = (ids: string[]) => summarizeExecution(executionMessages({ analyses: ids.map((id) => analysis(id)) }));

describe("v2: collect (sin IA)", () => {
  it("relevancia y filtros duros ANTES de Claude; prepara archivos para Claude", async () => {
    const s = setup();
    const c = await collect(s.deps, { runDate: "2026-10-06", trigger: "test", force: false });
    expect(c.started).toBe(true);
    if (!c.started) return;
    const st = c.state.stats;
    expect(st.candidates_found).toBe(5);
    expect(st.discarded_relevance).toBe(1); // copywriter
    expect(st.discarded_hard_filters).toBe(2); // full-time + hybrid
    expect(st.discarded_by_filter).toMatchObject({ "Jornada completa": 1 });
    expect(st.sent_to_claude).toBe(2);
    expect(c.state.to_claude[0]!.candidate.company).toBe("Acme"); // ordenadas por nota de código
    const files = readdirSync(join(s.workDir, "candidates"));
    expect(files).toEqual(["batch-01.md"]);
    const md = readFileSync(join(s.workDir, "candidates", "batch-01.md"), "utf8");
    expect(md).toContain("id: c001");
    expect(md).toContain("texto de terceros");
    expect(readFileSync(join(s.workDir, "instructions.md"), "utf8")).toContain("NO INVENTAR");
  });

  it("respeta el máximo de ofertas para Claude; el resto se guarda por código", async () => {
    const s = setup();
    s.env.MAX_CLAUDE_CANDIDATES = 1;
    const r = await runDay(s, "2026-10-06", claudeOk);
    expect(r.collect.started && r.collect.state.to_claude).toHaveLength(1);
    expect(r.store!.stats.inserted_claude).toBe(1);
    expect(r.store!.stats.inserted_code_only + r.store!.stats.discarded_low_score_code).toBe(1);
  });

  it("no se ejecuta dos veces el mismo día", async () => {
    const s = setup();
    await runDay(s, "2026-10-06", claudeOk);
    const again = await collect(s.deps, { runDate: "2026-10-06", trigger: "test", force: false });
    expect(again.started).toBe(false);
  });
});

describe("v2: store", () => {
  it("con Claude: guarda su puntuación y marca score_source=claude", async () => {
    const s = setup();
    const r = await runDay(s, "2026-10-06", claudeOk);
    expect(r.store!.status).toBe("success");
    expect(r.store!.stats.claude_status).toBe("ok");
    expect(r.store!.stats.analyzed_by_claude).toBe(2);
    const job = s.repo.jobs.find((j) => j.company === "Acme")! as unknown as Record<string, unknown>;
    expect(job.score).toBe(91);
    expect(job.score_source).toBe("claude");
    expect(typeof job.code_score).toBe("number");
    expect((r.store!.stats.claude_usage as Record<string, unknown>).output_tokens).toBe(5200);
  });

  it("si Claude falla (límite de uso), guarda TODO con puntuación por código y termina en 'partial'", async () => {
    const s = setup();
    const limit = () => summarizeExecution(executionMessages(null, { subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached" }));
    const r = await runDay(s, "2026-10-06", limit);
    expect(r.store!.stats.claude_status).toBe("usage_limit");
    expect(r.store!.status).toBe("partial");
    expect(s.repo.jobs.length).toBeGreaterThan(0);
    expect(s.repo.jobs.every((j) => (j as unknown as { score_source: string }).score_source === "code")).toBe(true);
  });

  it("sin token: se omite Claude y se guarda por código", async () => {
    const s = setup();
    const r = await runDay(s, "2026-10-06", claudeOk, "skipped_no_token");
    expect(r.store!.stats.claude_status).toBe("skipped_no_token");
    expect(s.repo.jobs.every((j) => (j as unknown as { score_source: string }).score_source === "code")).toBe(true);
  });

  it("salida inválida de Claude → respaldo por código; análisis válidos sueltos sí se usan", async () => {
    const s = setup();
    const partial = (ids: string[]) => summarizeExecution(executionMessages({ analyses: [analysis(ids[0]!), { id: ids[1], score: "mucho" }] }));
    const r = await runDay(s, "2026-10-06", partial);
    expect(r.store!.stats.claude_status).toBe("partial");
    expect(r.store!.stats.inserted_claude).toBe(1);
  });

  it("los filtros duros se re-aplican sobre los datos de Claude (p. ej. detecta híbrido)", async () => {
    const s = setup([offers.ideal]);
    const hybrid = (ids: string[]) => summarizeExecution(executionMessages({ analyses: [analysis(ids[0]!, { remote_type: "hybrid" })] }));
    const r = await runDay(s, "2026-10-06", hybrid);
    expect(r.store!.stats.discarded_by_claude_facts).toBe(1);
    expect(s.repo.jobs).toHaveLength(0);
    expect(s.repo.rejections[0]!.reasons[0]).toMatch(/híbrida.*Claude/);
  });

  it("una oferta puntuada solo por código se re-analiza con Claude cuando vuelve a aparecer", async () => {
    const s = setup([offers.ideal]);
    await runDay(s, "2026-10-06", claudeOk, "skipped_no_token");
    expect((s.repo.jobs[0] as unknown as { score_source: string }).score_source).toBe("code");
    const r = await runDay(s, "2026-10-07", claudeOk);
    expect(r.collect.started && r.collect.state.to_claude).toHaveLength(1);
    expect(r.store!.stats.upgraded_to_claude).toBe(1);
    expect(s.repo.jobs).toHaveLength(1);
    expect((s.repo.jobs[0] as unknown as { score_source: string }).score_source).toBe("claude");
    expect(s.repo.jobs[0]!.last_seen_date).toBe("2026-10-07");
  });

  it("descartada por el usuario: no vuelve ni se envía a Claude", async () => {
    const s = setup([offers.ideal]);
    await runDay(s, "2026-10-06", claudeOk);
    s.repo.jobs[0]!.status = "dismissed";
    const r = await runDay(s, "2026-10-07", claudeOk);
    expect(r.collect.started && r.collect.state.stats.skipped_dismissed).toBe(1);
    expect(r.collect.started && r.collect.state.to_claude).toHaveLength(0);
  });

  it("ya analizada por Claude y sin cambios: aparece hoy sin gastar cuota", async () => {
    const s = setup([offers.ideal]);
    await runDay(s, "2026-10-06", claudeOk);
    const r = await runDay(s, "2026-10-07", claudeOk);
    expect(r.collect.started && r.collect.state.to_claude).toHaveLength(0);
    expect(r.store!.stats.already_known).toBe(1);
    expect(r.store!.stats.claude_status).toBe("skipped_no_candidates");
    expect(s.repo.jobs[0]!.last_seen_date).toBe("2026-10-07");
  });

  it("guardada que cambia: se re-analiza y se marca como actualizada", async () => {
    const s = setup([offers.ideal]);
    await runDay(s, "2026-10-06", claudeOk);
    s.repo.jobs[0]!.status = "saved";
    s.deps.fetchSources = async () => [sourceResult("himalayas", [cand({ details: offers.ideal.details.replace("20 hours", "15 hours") })])];
    const r = await runDay(s, "2026-10-07", (ids) => summarizeExecution(executionMessages({ analyses: [analysis(ids[0]!, { hours_per_week: 15 })] })));
    expect(r.store!.stats.saved_updated).toBe(1);
    expect(s.repo.jobs[0]!.is_updated).toBe(true);
    expect(s.repo.jobs[0]!.hours_per_week).toBe(15);
    expect(s.repo.jobs[0]!.status).toBe("saved");
  });
});

describe("archivo de ejecución de claude-code-action", () => {
  it("lee la salida estructurada y el consumo", () => {
    const s = summarizeExecution(executionMessages({ analyses: [analysis("c001")] }));
    expect(s.status).toBe("ok");
    expect(s.analyses).toHaveLength(1);
    expect(s.usage).toMatchObject({ model: "claude-sonnet-5-5", num_turns: 4, input_tokens: 21000, equivalent_api_cost_usd: 0.31 });
  });
  it("detecta límite de uso y ejecuciones sin resultado", () => {
    expect(summarizeExecution([{ type: "system", subtype: "init" }, { type: "assistant", message: "Claude usage limit reached" }]).status).toBe("usage_limit");
    expect(summarizeExecution([{ type: "system", subtype: "init" }]).status).toBe("failed");
  });
  it("recoge eventos de límite de uso si existen", () => {
    const msgs = [...executionMessages({ analyses: [] }), { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", utilization: 0.8 } }];
    expect(summarizeExecution(msgs).usage!.rate_limit_events[0]).toMatchObject({ "rate_limit_info.utilization": 0.8 });
  });
});
