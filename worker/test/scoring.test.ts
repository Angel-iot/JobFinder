import { describe, expect, it } from "vitest";
import { applyHardFilters } from "../src/scoring/hardFilters.js";
import { mergeRedFlags, scoreJob } from "../src/scoring/score.js";
import { evaluation } from "./fixtures.js";

describe("filtros duros", () => {
  it("40 h jornada completa + 3000 €/mes + remoto → DESCARTAR", () => {
    const e = evaluation({
      employment_type: "full_time",
      hours_per_week: 40,
      salary_min: 3000,
      salary_max: 3000,
      salary_currency: "EUR",
      salary_period: "month",
    });
    const r = applyHardFilters(e);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Jornada completa/);
  });

  it("20 h + remoto pero turno 10:00–14:00 → DESCARTAR por horario", () => {
    const e = evaluation({ schedule: "10:00-14:00", schedule_start: "10:00", schedule_end: "14:00", afternoon_schedule_confirmed: false });
    const r = applyHardFilters(e);
    expect(r.passed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/10:00/);
  });

  it("15:00–19:00 no es compatible", () => {
    expect(applyHardFilters(evaluation({ schedule_start: "15:00" })).passed).toBe(false);
  });

  it.each(["16:00", "17:00", "18:00"])("empezar a las %s es compatible", (start) => {
    expect(applyHardFilters(evaluation({ schedule_start: start })).passed).toBe(true);
  });

  it("híbrido y presencial se descartan", () => {
    expect(applyHardFilters(evaluation({ remote_type: "hybrid" })).passed).toBe(false);
    expect(applyHardFilters(evaluation({ remote_type: "onsite" })).passed).toBe(false);
  });

  it("remoto que no permite España se descarta; ambiguo no", () => {
    expect(applyHardFilters(evaluation({ remote_allows_spain: "no" })).passed).toBe(false);
    expect(applyHardFilters(evaluation({ remote_allows_spain: "unknown" })).passed).toBe(true);
  });

  it("más de 25 h se descarta; 25 h no", () => {
    expect(applyHardFilters(evaluation({ hours_per_week: 30 })).passed).toBe(false);
    expect(applyHardFilters(evaluation({ hours_per_week: 25 })).passed).toBe(true);
  });

  it("senior e inglés avanzado se descartan", () => {
    expect(applyHardFilters(evaluation({ seniority: "senior" })).passed).toBe(false);
    expect(applyHardFilters(evaluation({ english_level_required: "advanced" })).passed).toBe(false);
    expect(applyHardFilters(evaluation({ english_level_required: "fluent" })).passed).toBe(false);
  });

  it("exigir mañanas se descarta aunque no haya hora concreta", () => {
    expect(
      applyHardFilters(evaluation({ schedule_start: null, requires_morning_availability: "yes", afternoon_schedule_confirmed: false })).passed,
    ).toBe(false);
  });

  it("datos desconocidos NO descartan", () => {
    const e = evaluation({
      remote_type: "unknown",
      employment_type: "unknown",
      hours_per_week: null,
      schedule: null,
      schedule_start: null,
      requires_morning_availability: "unknown",
      afternoon_schedule_confirmed: false,
      english_level_required: "unknown",
      seniority: "unknown",
    });
    expect(applyHardFilters(e).passed).toBe(true);
  });
});

describe("puntuación", () => {
  it("20 h + remoto + tardes + formación → candidato excelente (prioridad alta)", () => {
    const r = scoreJob(evaluation());
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.priority).toBe("high");
  });

  it("25 h + remoto + tardes + excelente formación → interesante, no alta", () => {
    const r = scoreJob(evaluation({ hours_per_week: 25, assessment: { learning: 95, asir_fit: 90, role_fit: 90, technologies: 85, other: 80 } }));
    expect(r.priority).toBe("interesting");
    expect(r.score).toBeLessThan(scoreJob(evaluation()).score);
  });

  it("no publicar salario es solo una pequeña penalización", () => {
    const withSalary = scoreJob(evaluation({ salary_min: 900, salary_max: 1000, salary_currency: "EUR", salary_period: "month" }));
    const without = scoreJob(evaluation());
    const diff = withSalary.score - without.score;
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThanOrEqual(3);
    expect(without.warnings).toContain("No publica salario");
  });

  it("horario no especificado se indica y puntúa menos", () => {
    const r = scoreJob(evaluation({ schedule: null, schedule_start: null, requires_morning_availability: "unknown", afternoon_schedule_confirmed: false }));
    expect(r.warnings).toContain("Horario no especificado");
    expect(r.score).toBeLessThan(scoreJob(evaluation()).score);
  });

  it("remoto Europa ambiguo se avisa y nunca es prioridad alta sin remoto confirmado", () => {
    const ambiguous = scoreJob(evaluation({ remote_allows_spain: "unknown", remote_scope: "Remote Europe" }));
    expect(ambiguous.warnings.join(" ")).toMatch(/ambigua/);
    const unknownRemote = scoreJob(evaluation({ remote_type: "unknown" }));
    expect(unknownRemote.priority).not.toBe("high");
  });

  it("inglés B2 penaliza fuerte", () => {
    const r = scoreJob(evaluation({ english_level_required: "upper_intermediate" }));
    expect(scoreJob(evaluation()).score - r.score).toBeGreaterThanOrEqual(15);
    expect(r.warnings).toContain("Inglés B2 requerido");
  });

  it("más formación puntúa más que menos formación (resto igual)", () => {
    const high = scoreJob(evaluation({ assessment: { learning: 95, asir_fit: 80, role_fit: 80, technologies: 80, other: 70 } }));
    const low = scoreJob(evaluation({ assessment: { learning: 20, asir_fit: 80, role_fit: 80, technologies: 80, other: 70 } }));
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("la puntuación está siempre entre 0 y 100", () => {
    const worst = scoreJob(
      evaluation({
        remote_type: "unknown",
        hours_per_week: null,
        employment_type: "unknown",
        schedule_start: null,
        afternoon_schedule_confirmed: false,
        requires_morning_availability: "unknown",
        experience_years_min: 5,
        english_level_required: "upper_intermediate",
        assessment: { learning: 0, asir_fit: 0, role_fit: 0, technologies: 0, other: 0 },
      }),
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(scoreJob(evaluation({ salary_min: 1, assessment: { learning: 100, asir_fit: 100, role_fit: 100, technologies: 100, other: 100 } })).score).toBeLessThanOrEqual(100);
  });

  it("mergeRedFlags elimina duplicados ignorando mayúsculas y acentos", () => {
    expect(mergeRedFlags(["No publica salario", "Inglés B2"], ["no publica salario"])).toEqual(["no publica salario", "Inglés B2"]);
  });
});
