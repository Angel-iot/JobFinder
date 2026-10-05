/**
 * Evaluación SOLO POR CÓDIGO. Se usa para:
 *   1. aplicar los filtros duros antes de Claude (mismas reglas que la v1);
 *   2. calcular la puntuación de respaldo si Claude falla o se agota la cuota.
 *
 * La valoración subjetiva (formación, encaje, tecnologías) se estima con
 * reglas sencillas y conservadoras; Claude la sustituye cuando está disponible.
 */
import type { JobEvaluation } from "../claude/schemas.js";
import { applyHardFilters, type HardFilterResult } from "../scoring/hardFilters.js";
import { scoreJob, type ScoreResult } from "../scoring/score.js";
import type { CodeFacts } from "./facts.js";
import type { V2Candidate } from "./types.js";

/** Tecnologías detectables que el perfil NO conoce (profile.ts: Python "no", SQL "no"; Kubernetes no figura). */
const UNKNOWN_TECH = new Set(["Python", "SQL", "Kubernetes"]);

export interface CodeAssessment {
  evaluation: JobEvaluation;
  filter: HardFilterResult;
  score: ScoreResult | null;
}

export function codeEvaluation(c: V2Candidate, f: CodeFacts): JobEvaluation {
  const learning = Math.min(90, 45 + f.training_signals.length * 15 + (f.seniority === "junior" || f.seniority === "intern" ? 5 : 0));
  const itCore = f.technologies.filter((t) => !UNKNOWN_TECH.has(t)).length;
  const unknown = f.technologies.filter((t) => UNKNOWN_TECH.has(t)).length;
  const technologies = f.technologies.length ? Math.max(20, Math.min(90, 50 + itCore * 8 - unknown * 15)) : 50;
  const asirFit = Math.min(90, 45 + itCore * 7);
  const roleFit = /help ?desk|service ?desk|soporte|support|t[eé]cnico|technician|sysadmin|sistemas|systems/i.test(c.title) ? 70 : 50;

  const matchReasons: string[] = [];
  if (f.hours_per_week !== null && f.hours_per_week <= 20) matchReasons.push(`${f.hours_per_week} h semanales`);
  if (f.employment_type === "part_time") matchReasons.push("Jornada parcial");
  if (f.remote_type === "full_remote" && f.remote_allows_spain === "yes") matchReasons.push("100% remoto (admite España)");
  else if (f.remote_type === "full_remote") matchReasons.push("100% remoto");
  if (f.afternoon_schedule_confirmed) matchReasons.push("Turno de tarde");
  if (f.seniority === "junior" || f.seniority === "intern") matchReasons.push("Puesto junior");
  if (f.training_signals.length) matchReasons.push(`Menciona formación/mentoría (${f.training_signals.slice(0, 2).join(", ")})`);
  for (const t of f.technologies.filter((x) => !UNKNOWN_TECH.has(x)).slice(0, 3)) matchReasons.push(`Trabaja con ${t}`);

  const redFlags = ["Valoración automática por reglas (sin análisis de IA)"];
  if (f.other_language_required) redFlags.push(`Idioma exigido: ${f.other_language_required}`);
  for (const t of f.technologies.filter((x) => UNKNOWN_TECH.has(x))) redFlags.push(`Menciona ${t} (no lo conoces)`);

  return {
    candidate_index: 0,
    is_individual_job_offer: true,
    title: c.title,
    company: c.company,
    location: c.location,
    remote_type: f.remote_type,
    remote_scope: f.remote_scope,
    remote_allows_spain: f.remote_allows_spain,
    employment_type: f.employment_type,
    hours_per_week: f.hours_per_week,
    schedule: f.schedule,
    schedule_start: f.schedule_start,
    schedule_end: f.schedule_end,
    requires_morning_availability: f.requires_morning_availability,
    afternoon_schedule_confirmed: f.afternoon_schedule_confirmed,
    salary_min: f.salary_min,
    salary_max: f.salary_max,
    salary_currency: f.salary_currency,
    salary_period: f.salary_period,
    salary_text: null,
    experience_required: f.experience_required,
    experience_years_min: f.experience_years_min,
    education_required: null,
    english_level_required: f.english_level_required,
    seniority: f.seniority,
    technologies: f.technologies,
    requirements: [],
    training_info: f.training_signals.length ? f.training_signals.join("; ") : null,
    growth_info: null,
    summary: "",
    match_reasons: matchReasons,
    red_flags: redFlags,
    assessment: { learning, asir_fit: asirFit, role_fit: roleFit, technologies, other: 50 },
    assessment_notes: "Estimación por reglas de código.",
  };
}

/** Filtros duros de la v1 + idioma no hablado exigido. */
export function hardFiltersV2(e: JobEvaluation, otherLanguage: string | null): HardFilterResult {
  const base = applyHardFilters(e);
  const reasons = [...base.reasons];
  if (otherLanguage) reasons.push(`Exige otro idioma con nivel alto (${otherLanguage})`);
  return { passed: reasons.length === 0, reasons };
}

export function assessByCode(c: V2Candidate, f: CodeFacts): CodeAssessment {
  const evaluation = codeEvaluation(c, f);
  const filter = hardFiltersV2(evaluation, f.other_language_required);
  return { evaluation, filter, score: filter.passed ? scoreJob(evaluation) : null };
}
