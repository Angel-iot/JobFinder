import { describe, expect, it } from "vitest";
import { applyFilters, defaultFilters, groupByPriority } from "./filters";
import { hoursLabel, madridToday, remoteLabel, salaryLabel, scheduleLabel } from "./format";
import type { Job } from "./types";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "1", source: "linkedin", url: "https://x", canonical_url: "https://x", alternate_urls: [],
    title: "Helpdesk", company: "Acme", location: null, remote_type: "full_remote", remote_scope: "España",
    remote_location_ambiguous: false, employment_type: "part_time", hours_per_week: 20, schedule: null,
    salary_min: null, salary_max: null, salary_currency: null, salary_period: null, salary_text: null,
    experience_required: null, education_required: null, english_level: "none", description: null, summary: null,
    requirements: [], technologies: [], training_info: null, growth_info: null, match_reasons: [], red_flags: [],
    score: 80, priority: "high", published_at: null, found_at: "2026-10-05T09:00:00Z", last_seen_date: "2026-10-05",
    status: "new", is_updated: false, ...overrides,
  };
}

describe("textos de la tarjeta (nunca inventan)", () => {
  it("salario ausente → 'Salario no especificado'", () => {
    expect(salaryLabel(job())).toBe("Salario no especificado");
    expect(salaryLabel(job({ salary_min: 900, salary_max: 1100, salary_currency: "EUR", salary_period: "month" }))).toBe("900–1100€/mes");
  });
  it("horario ausente → 'Horario no especificado'", () => {
    expect(scheduleLabel(job())).toBe("Horario no especificado");
    expect(scheduleLabel(job({ schedule: "16:00-20:00" }))).toBe("16:00-20:00");
  });
  it("media jornada sin horas no se convierte en 20 h", () => {
    expect(hoursLabel(job({ hours_per_week: null }))).toBe("Media jornada (horas no especificadas)");
  });
  it("remoto ambiguo se indica", () => {
    expect(remoteLabel(job({ remote_location_ambiguous: true, remote_scope: "Remote Europe" }))).toMatch(/ambigua/);
    expect(remoteLabel(job({ remote_type: "unknown" }))).toBe("Modalidad no especificada");
  });
  it("fecha de Madrid", () => {
    expect(madridToday(new Date("2026-10-05T22:30:00Z"))).toBe("2026-10-06");
  });
});

describe("filtros", () => {
  const jobs = [
    job({ id: "a", score: 90, hours_per_week: 20 }),
    job({ id: "b", score: 60, hours_per_week: 25, priority: "interesting", source: "infojobs", salary_min: 800 }),
    job({ id: "c", score: 40, hours_per_week: null, priority: "other", remote_location_ambiguous: true, status: "saved", title: "Técnico de sistemas" }),
  ];
  const ids = (list: Job[]) => list.map((j) => j.id);

  it("ordena por puntuación descendente", () => {
    expect(ids(applyFilters([...jobs].reverse(), defaultFilters))).toEqual(["a", "b", "c"]);
  });
  it("puntuación mínima, horas, fuente, modalidad, salario, puesto y estado", () => {
    expect(ids(applyFilters(jobs, { ...defaultFilters, minScore: 50 }))).toEqual(["a", "b"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, hours: "le20" }))).toEqual(["a"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, hours: "unknown" }))).toEqual(["c"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, source: "infojobs" }))).toEqual(["b"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, remote: "unconfirmed" }))).toEqual(["c"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, salary: "published" }))).toEqual(["b"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, role: "tecnico" }))).toEqual(["c"]);
    expect(ids(applyFilters(jobs, { ...defaultFilters, status: "saved" }))).toEqual(["c"]);
  });
  it("agrupa por prioridad", () => {
    const g = groupByPriority(jobs);
    expect(ids(g.high)).toEqual(["a"]);
    expect(ids(g.interesting)).toEqual(["b"]);
    expect(ids(g.other)).toEqual(["c"]);
  });
});
