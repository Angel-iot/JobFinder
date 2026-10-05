import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { JobEvaluation } from "../src/claude/schemas.js";
import type { IdentifiedCandidate } from "../src/dedup/dedup.js";
import { Logger } from "../src/lib/logger.js";
import { runDailySearch, type PipelineDeps } from "../src/pipeline.js";
import type { RawCandidate } from "../src/sources/types.js";
import { InMemoryRepository } from "../src/storage/repository.js";
import { evaluation, rawCandidate, testEnv } from "./fixtures.js";

const silentLog = new Logger();
silentLog.info = () => {};
silentLog.warn = () => {};
silentLog.error = () => {};
silentLog.child = () => silentLog;

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 };

function deps(
  repo: InMemoryRepository,
  found: RawCandidate[],
  evaluate: (c: IdentifiedCandidate) => JobEvaluation,
): PipelineDeps {
  return {
    env: testEnv,
    repo,
    claude: {} as Anthropic,
    log: silentLog,
    batches: [{ id: "test", focus: "test", queries: ["q"] }],
    discover: async () => ({
      candidates: found,
      stats: { source: "claude:test", searches: 3, fetches: 1, results: 12, candidates: found.length, errors: [] },
      usage,
    }),
    evaluate: async (cs) => ({
      evaluated: cs.map((candidate) => ({ candidate, evaluation: evaluate(candidate) })),
      failed: [],
      usage,
    }),
  };
}

const offers = {
  ideal: rawCandidate({ url: "https://acme.com/jobs/1", title: "Helpdesk junior", company: "Acme" }),
  fullTime: rawCandidate({ url: "https://beta.com/jobs/2", title: "IT Support", company: "Beta" }),
  hybrid: rawCandidate({ url: "https://gamma.com/jobs/3", title: "Técnico de sistemas", company: "Gamma" }),
};

function evaluator(c: IdentifiedCandidate): JobEvaluation {
  if (c.company === "Beta") return evaluation({ title: c.title, company: c.company, employment_type: "full_time", hours_per_week: 40 });
  if (c.company === "Gamma") return evaluation({ title: c.title, company: c.company, remote_type: "hybrid" });
  return evaluation({ title: c.title, company: c.company });
}

describe("pipeline diario", () => {
  it("busca, filtra, puntúa y guarda solo lo relevante", async () => {
    const repo = new InMemoryRepository();
    const result = await runDailySearch(deps(repo, Object.values(offers), evaluator), {
      runDate: "2026-10-05",
      trigger: "test",
      force: false,
    });
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") return;
    expect(result.status).toBe("success");
    expect(result.stats.searches).toBe(3);
    expect(result.stats.candidates_found).toBe(3);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.discarded_hard_filters).toBe(2);
    expect(repo.jobs).toHaveLength(1);
    expect(repo.jobs[0]!.status).toBe("new");
    expect(repo.jobs[0]!.salary_min).toBeNull(); // nunca se inventa
    expect(repo.jobs[0]!.red_flags).toContain("No publica salario");
    expect(repo.rejections.map((r) => r.company).sort()).toEqual(["Beta", "Gamma"]);
  });

  it("no ejecuta dos veces la búsqueda del mismo día (salvo --force)", async () => {
    const repo = new InMemoryRepository();
    const d = deps(repo, [offers.ideal], evaluator);
    await runDailySearch(d, { runDate: "2026-10-05", trigger: "test", force: false });
    const second = await runDailySearch(d, { runDate: "2026-10-05", trigger: "test", force: false });
    expect(second.kind).toBe("skipped");
    const forced = await runDailySearch(d, { runDate: "2026-10-05", trigger: "test", force: true });
    expect(forced.kind).toBe("completed");
    const nextDay = await runDailySearch(d, { runDate: "2026-10-06", trigger: "test", force: false });
    expect(nextDay.kind).toBe("completed");
  });

  it("una oferta descartada por el usuario no vuelve a aparecer ni se re-analiza", async () => {
    const repo = new InMemoryRepository();
    let evaluations = 0;
    const counting = (c: IdentifiedCandidate) => {
      evaluations++;
      return evaluator(c);
    };
    await runDailySearch(deps(repo, [offers.ideal], counting), { runDate: "2026-10-05", trigger: "t", force: false });
    repo.jobs[0]!.status = "dismissed";
    const result = await runDailySearch(deps(repo, [offers.ideal], counting), { runDate: "2026-10-06", trigger: "t", force: false });
    expect(evaluations).toBe(1);
    expect(result.kind === "completed" && result.stats.skipped_dismissed).toBe(1);
    expect(repo.jobs[0]!.last_seen_date).toBe("2026-10-05");
  });

  it("una oferta nueva ya conocida reaparece hoy sin volver a pagar el análisis", async () => {
    const repo = new InMemoryRepository();
    let evaluations = 0;
    const counting = (c: IdentifiedCandidate) => {
      evaluations++;
      return evaluator(c);
    };
    await runDailySearch(deps(repo, [offers.ideal], counting), { runDate: "2026-10-05", trigger: "t", force: false });
    await runDailySearch(deps(repo, [offers.ideal], counting), { runDate: "2026-10-06", trigger: "t", force: false });
    expect(evaluations).toBe(1);
    expect(repo.jobs).toHaveLength(1);
    expect(repo.jobs[0]!.last_seen_date).toBe("2026-10-06");
    expect(repo.jobs[0]!.first_seen_date).toBe("2026-10-05");
  });

  it("una oferta guardada que cambia se marca como actualizada", async () => {
    const repo = new InMemoryRepository();
    await runDailySearch(deps(repo, [offers.ideal], evaluator), { runDate: "2026-10-05", trigger: "t", force: false });
    repo.jobs[0]!.status = "saved";
    const changed = (c: IdentifiedCandidate) => evaluation({ title: c.title, company: c.company, hours_per_week: 15 });
    const result = await runDailySearch(deps(repo, [offers.ideal], changed), { runDate: "2026-10-06", trigger: "t", force: false });
    expect(result.kind === "completed" && result.stats.saved_updated).toBe(1);
    expect(repo.jobs[0]!.is_updated).toBe(true);
    expect(repo.jobs[0]!.hours_per_week).toBe(15);
    expect(repo.jobs[0]!.status).toBe("saved");
  });

  it("las ofertas rechazadas por filtros no se re-analizan al día siguiente", async () => {
    const repo = new InMemoryRepository();
    let evaluations = 0;
    const counting = (c: IdentifiedCandidate) => {
      evaluations++;
      return evaluator(c);
    };
    await runDailySearch(deps(repo, [offers.fullTime], counting), { runDate: "2026-10-05", trigger: "t", force: false });
    const r = await runDailySearch(deps(repo, [offers.fullTime], counting), { runDate: "2026-10-06", trigger: "t", force: false });
    expect(evaluations).toBe(1);
    expect(r.kind === "completed" && r.stats.skipped_previously_rejected).toBe(1);
  });

  it("marca la ejecución como fallida si todas las búsquedas fallan", async () => {
    const repo = new InMemoryRepository();
    const d = deps(repo, [], evaluator);
    d.discover = async () => ({
      candidates: [],
      stats: { source: "claude:test", searches: 0, fetches: 0, results: 0, candidates: 0, errors: ["Claude: API key inválida o sin permisos (401)"] },
      usage,
    });
    const result = await runDailySearch(d, { runDate: "2026-10-05", trigger: "t", force: false });
    expect(result.kind === "completed" && result.status).toBe("failed");
    // Una ejecución fallida puede reintentarse el mismo día.
    const retry = await runDailySearch(deps(repo, [offers.ideal], evaluator), { runDate: "2026-10-05", trigger: "t", force: false });
    expect(retry.kind).toBe("completed");
  });
});
