import { describe, expect, it } from "vitest";
import { assessByCode } from "../../src/v2/codeEvaluation.js";
import { classifyLocationRestriction, extractFacts } from "../../src/v2/facts.js";
import { assessRelevance } from "../../src/v2/relevance.js";
import { cand } from "./fixtures.js";

const facts = (details: string, extra: Parameters<typeof cand>[0] = {}) => extractFacts(cand({ details, ...extra }));

describe("extracción por código: modalidad y ubicación", () => {
  it("detecta híbrido aunque venga de un portal remoto", () => {
    expect(facts("Hybrid role: 2 days in the office in Madrid").remote_type).toBe("hybrid");
    expect(facts("Puesto híbrido en Valencia").remote_type).toBe("hybrid");
    expect(facts("3 días a la semana en la oficina").remote_type).toBe("hybrid");
  });
  it("portal remoto sin señales de presencialidad → 100% remoto", () => {
    expect(facts("Support customers from home").remote_type).toBe("full_remote");
  });
  it("fuera de portales remotos solo marca remoto con mención explícita", () => {
    const hints = { remote_board: false, spain_allowed_by_query: false };
    expect(facts("Oferta de técnico en Valencia", { hints }).remote_type).toBe("unknown");
    expect(facts("Puesto 100% remoto desde casa", { hints }).remote_type).toBe("full_remote");
    expect(facts("Trabajo presencial en oficina", { hints }).remote_type).toBe("onsite");
  });
  it("clasifica restricciones geográficas: España/Worldwide sí, Europa ambiguo, otros países no", () => {
    expect(classifyLocationRestriction("Worldwide")).toBe("yes");
    expect(classifyLocationRestriction("Spain, Portugal")).toBe("yes");
    expect(classifyLocationRestriction("Europe")).toBe("unknown");
    expect(classifyLocationRestriction("EMEA")).toBe("unknown");
    expect(classifyLocationRestriction("USA")).toBe("no");
    expect(classifyLocationRestriction("UK, Canada")).toBe("no");
    expect(classifyLocationRestriction(null)).toBe("unknown");
  });
});

describe("extracción por código: jornada y horario", () => {
  it("horas semanales en varios formatos", () => {
    expect(facts("20 horas semanales").hours_per_week).toBe(20);
    expect(facts("Jornada de 25h/semana").hours_per_week).toBe(25);
    expect(facts("20-25 hours per week").hours_per_week).toBe(25);
    expect(facts("salary 20-25k").hours_per_week).toBeNull();
  });
  it("tipo de jornada", () => {
    expect(facts("Jornada completa").employment_type).toBe("full_time");
    expect(facts("media jornada").employment_type).toBe("part_time");
    expect(facts("part-time or full-time").employment_type).toBe("unknown");
    expect(facts("x", { hints: { employment_type: "full_time" } }).employment_type).toBe("full_time");
  });
  it("horario con horas y turnos", () => {
    const f = facts("Horario de 16:00 a 20:00");
    expect([f.schedule_start, f.schedule_end]).toEqual(["16:00", "20:00"]);
    expect(facts("de 9 a 14h").schedule_start).toBe("09:00");
    expect(facts("Turno de mañana").requires_morning_availability).toBe("yes");
    expect(facts("Turno de tarde").afternoon_schedule_confirmed).toBe(true);
    expect(facts("x", { hints: { workday_text: "Parcial - Tarde" } }).afternoon_schedule_confirmed).toBe(true);
    expect(facts("x", { hints: { workday_text: "Parcial - Mañana" } }).requires_morning_availability).toBe("yes");
  });
  it("sin horario → desconocido (no se inventa)", () => {
    const f = facts("Great team, remote");
    expect(f.schedule).toBeNull();
    expect(f.schedule_start).toBeNull();
    expect(f.requires_morning_availability).toBe("unknown");
  });
});

describe("extracción por código: seniority, idiomas, experiencia", () => {
  it("seniority por título", () => {
    expect(facts("x", { title: "Senior IT Support Engineer" }).seniority).toBe("senior");
    expect(facts("x", { title: "Junior Helpdesk" }).seniority).toBe("junior");
    expect(facts("x", { title: "IT Support Team Lead" }).seniority).toBe("lead");
  });
  it("inglés exigido, ignorando 'valorable / nice to have'", () => {
    expect(facts("Fluent English required").english_level_required).toBe("advanced");
    expect(facts("Inglés C1").english_level_required).toBe("advanced");
    expect(facts("English B2").english_level_required).toBe("upper_intermediate");
    expect(facts("Inglés intermedio").english_level_required).toBe("intermediate");
    expect(facts("Fluent English is a plus").english_level_required).toBe("unknown");
    expect(facts("Se valorará inglés avanzado").english_level_required).toBe("unknown");
  });
  it("otros idiomas con nivel alto", () => {
    expect(facts("Fließende Deutschkenntnisse").other_language_required).toBeTruthy();
    expect(facts("Fluent German required").other_language_required).toBeTruthy();
    expect(facts("German is nice to have").other_language_required).toBeNull();
  });
  it("experiencia", () => {
    expect(facts("2 años de experiencia").experience_years_min).toBe(2);
    expect(facts("at least 3 years").experience_years_min).toBe(3);
    expect(facts("Experiencia mínima: No requerida").experience_years_min).toBe(0);
    expect(facts("sin datos").experience_years_min).toBeNull();
  });
  it("formación y tecnologías", () => {
    const f = facts("Plan de formación y mentoring. Windows, Linux, Python");
    expect(f.training_signals.length).toBeGreaterThanOrEqual(2);
    expect(f.technologies).toEqual(expect.arrayContaining(["Windows", "Linux", "Python"]));
  });
});

describe("filtros duros por código (antes de Claude)", () => {
  it("la oferta ideal pasa y puntúa alto", () => {
    const c = cand();
    const r = assessByCode(c, extractFacts(c));
    expect(r.filter.passed).toBe(true);
    expect(r.score!.score).toBeGreaterThanOrEqual(70);
  });
  it.each([
    ["jornada completa", "Full-time position, 40 hours per week"],
    ["híbrida", "Hybrid, 2 days in the office"],
    ["mañanas", "Horario de 9:00 a 14:00"],
    ["inglés fluido", "Fluent English required"],
    ["alemán", "Fluent German required"],
  ])("descarta: %s", (_label, details) => {
    const c = cand({ details });
    expect(assessByCode(c, extractFacts(c)).filter.passed).toBe(false);
  });
  it("descarta senior y ubicaciones que no admiten España", () => {
    const senior = cand({ title: "Senior Service Desk Analyst" });
    expect(assessByCode(senior, extractFacts(senior)).filter.passed).toBe(false);
    const us = cand({ details: "Remote", hints: { spain_allowed_by_query: false, location_restriction: "USA only" } });
    expect(assessByCode(us, extractFacts(us)).filter.passed).toBe(false);
  });
  it("lo desconocido NO descarta y la fila de respaldo lo indica", () => {
    const c = cand({ details: "Remote support role for our customers' devices and tickets." });
    const r = assessByCode(c, extractFacts(c));
    expect(r.filter.passed).toBe(true);
    expect(r.evaluation.red_flags[0]).toMatch(/sin análisis de IA/);
    expect(r.score!.warnings).toContain("Horario no especificado");
  });
});

describe("relevancia del puesto", () => {
  it.each(["IT Helpdesk Technician", "Service Desk Analyst", "Técnico Informático", "Soporte técnico N1", "Junior Systems Administrator", "Linux Support Engineer"])(
    "relevante: %s",
    (title) => expect(assessRelevance(title, "").relevant).toBe(true),
  );
  it.each(["Senior Software Engineer", "Marketing Manager", "Freelance Copywriter", "Account Executive", "Frontend Developer"])(
    "no relevante: %s",
    (title) => expect(assessRelevance(title, "windows linux tickets helpdesk").relevant).toBe(false),
  );
  it("título genérico depende del contexto IT", () => {
    expect(assessRelevance("Support Specialist", "Troubleshoot Windows and hardware issues, tickets in Jira").relevant).toBe(true);
    expect(assessRelevance("Support Specialist", "Answer customer emails about billing").relevant).toBe(false);
  });
});
