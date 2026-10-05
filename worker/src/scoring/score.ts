/**
 * Puntuación final 0–100 de una oferta que YA ha pasado los filtros duros.
 *
 * - Horario, remoto, jornada, experiencia y salario: reglas fijas en código.
 * - Aprendizaje, encaje ASIR, adecuación del puesto, tecnologías y otros:
 *   valoración subjetiva de Claude (0–100), ponderada aquí.
 * - Penalización por inglés exigido por encima del nivel real.
 */
import { preferences, scoreWeights, type ScoreComponent } from "../config/preferences.js";
import type { JobEvaluation } from "../claude/schemas.js";
import { parseClock } from "../lib/time.js";

export type Priority = "high" | "interesting" | "other";

export interface ScoreResult {
  score: number;
  priority: Priority;
  /** Puntos obtenidos por componente (máximo = peso). */
  breakdown: Record<ScoreComponent, number> & { englishPenalty: number };
  reasons: string[];
  /** Avisos que deben mostrarse como "Posibles problemas". */
  warnings: string[];
}

const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const ratio = (n: number) => clamp(Math.round(n)) / 100;

export function scoreJob(e: JobEvaluation): ScoreResult {
  const W = scoreWeights;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Horario
  let schedule: number;
  const start = parseClock(e.schedule_start);
  const earliest = parseClock(preferences.schedule.earliestStart)!;
  if ((start !== null && start >= earliest) || e.afternoon_schedule_confirmed) {
    schedule = W.schedule;
    reasons.push("Horario de tarde compatible");
  } else if (e.requires_morning_availability === "no") {
    schedule = Math.round(W.schedule * 0.75);
    reasons.push("Horario flexible / sin mañanas (no confirma tarde)");
  } else {
    schedule = Math.round(W.schedule * 0.4);
    reasons.push("Horario no especificado");
    warnings.push("Horario no especificado");
  }

  // 2. Remoto (los híbridos/presenciales ya se han descartado)
  let remote: number;
  if (e.remote_type === "full_remote" && e.remote_allows_spain === "yes") {
    remote = W.remote;
    reasons.push("100% remoto desde España");
  } else if (e.remote_type === "full_remote") {
    remote = Math.round(W.remote * 0.55);
    reasons.push("100% remoto, pero no confirma que admita España");
    warnings.push(`Ubicación remota ambigua${e.remote_scope ? ` (${e.remote_scope})` : ""}: no confirma que se pueda trabajar desde España`);
  } else {
    remote = Math.round(W.remote * 0.2);
    reasons.push("Modalidad no confirmada");
    warnings.push("Modalidad no confirmada: comprobar que sea 100% remoto");
  }

  // 3. Jornada
  let hours: number;
  const h = e.hours_per_week;
  if (h !== null && h <= preferences.hours.idealMax) {
    hours = W.hours;
    reasons.push(`${h} h/semana (ideal)`);
  } else if (h !== null && h <= preferences.hours.acceptableMax) {
    hours = Math.round(W.hours * 0.45);
    reasons.push(`${h} h/semana (aceptable solo si la oferta es muy buena)`);
    warnings.push(`${h} h semanales (más de ${preferences.hours.idealMax} h)`);
  } else if (e.employment_type === "part_time") {
    hours = Math.round(W.hours * 0.65);
    reasons.push("Jornada parcial sin horas concretas");
    warnings.push("Horas semanales no especificadas");
  } else {
    hours = Math.round(W.hours * 0.3);
    reasons.push("Jornada no especificada");
    warnings.push("Jornada no especificada");
  }

  // 4–6, 9–10. Valoración subjetiva de Claude
  const learning = Math.round(W.learning * ratio(e.assessment.learning));
  const asirFit = Math.round(W.asirFit * ratio(e.assessment.asir_fit));
  const roleFit = Math.round(W.roleFit * ratio(e.assessment.role_fit));
  const technologies = Math.round(W.technologies * ratio(e.assessment.technologies));
  const other = Math.round(W.other * ratio(e.assessment.other));
  reasons.push(
    `Aprendizaje ${e.assessment.learning}/100, encaje ASIR ${e.assessment.asir_fit}/100, puesto ${e.assessment.role_fit}/100`,
  );

  // 7. Experiencia
  let experience: number;
  const years = e.experience_years_min;
  if (years === null) {
    experience = e.experience_required ? Math.round(W.experience * 0.6) : Math.round(W.experience * 0.75);
  } else if (years <= 0.5) {
    experience = W.experience;
  } else if (years <= 1) {
    experience = Math.round(W.experience * 0.75);
  } else if (years <= 2) {
    experience = Math.round(W.experience * 0.4);
    warnings.push(`Pide ${years} años de experiencia`);
  } else {
    experience = 0;
    warnings.push(`Pide ${years} años de experiencia`);
  }

  // 8. Salario (no publicado = pequeña penalización, nunca descarte)
  const hasSalary = e.salary_min !== null || e.salary_max !== null;
  const salary = hasSalary ? W.salary : Math.max(0, W.salary - preferences.noSalaryPenalty);
  if (!hasSalary) warnings.push("No publica salario");

  // Inglés
  const englishPenalty = preferences.english.penalties[e.english_level_required] ?? 0;
  if (englishPenalty > 0) {
    warnings.push(e.english_level_required === "upper_intermediate" ? "Inglés B2 requerido" : "Inglés intermedio requerido");
  }

  const breakdown = { schedule, remote, hours, learning, asirFit, roleFit, experience, salary, technologies, other, englishPenalty };
  const total = clamp(
    schedule + remote + hours + learning + asirFit + roleFit + experience + salary + technologies + other - englishPenalty,
  );

  return { score: total, priority: priorityFor(total, e), breakdown, reasons, warnings };
}

export function priorityFor(score: number, e: Pick<JobEvaluation, "remote_type" | "hours_per_week">): Priority {
  // "Prioridad alta" exige remoto confirmado y jornada dentro del ideal;
  // 21–25 h como mucho es "interesante".
  const idealHours = e.hours_per_week === null || e.hours_per_week <= preferences.hours.idealMax;
  if (score >= preferences.priority.high && e.remote_type === "full_remote" && idealHours) return "high";
  if (score >= preferences.priority.interesting) return "interesting";
  return "other";
}

/** Une los problemas de Claude con los avisos del sistema, sin duplicados. */
export function mergeRedFlags(fromClaude: string[], warnings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...warnings, ...fromClaude]) {
    const key = item.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
