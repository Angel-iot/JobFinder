/**
 * REQUISITOS FUNDAMENTALES = FILTROS EN CÓDIGO.
 * Si una oferta incumple uno de forma explícita, se descarta. Nada (ni el
 * salario ni la valoración de Claude) puede compensarlo.
 * Si un dato es desconocido, NO se descarta: se penaliza en la puntuación.
 */
import { preferences } from "../config/preferences.js";
import type { JobEvaluation } from "../claude/schemas.js";
import { parseClock } from "../lib/time.js";

export interface HardFilterResult {
  passed: boolean;
  reasons: string[];
}

export function applyHardFilters(e: JobEvaluation): HardFilterResult {
  const reasons: string[] = [];

  if (!e.is_individual_job_offer) reasons.push("No es una oferta de empleo individual y activa");

  // Modalidad: 100% remoto obligatorio.
  if (e.remote_type === "hybrid") reasons.push("Modalidad híbrida (se exige 100% remoto)");
  if (e.remote_type === "onsite") reasons.push("Modalidad presencial (se exige 100% remoto)");

  // Ubicación: tiene que permitir trabajar desde España.
  if (e.remote_allows_spain === "no") reasons.push("No permite trabajar desde España");

  // Jornada.
  if (e.employment_type === "full_time") reasons.push("Jornada completa");
  if (e.hours_per_week !== null && e.hours_per_week > preferences.hours.acceptableMax) {
    reasons.push(`${e.hours_per_week} h/semana (máximo ${preferences.hours.acceptableMax} h)`);
  }

  // Horario: solo tardes a partir de earliestStart.
  const earliest = parseClock(preferences.schedule.earliestStart)!;
  const start = parseClock(e.schedule_start);
  if (start !== null && start < earliest) {
    reasons.push(`Empieza a las ${e.schedule_start} (disponible desde las ${preferences.schedule.earliestStart})`);
  } else if (e.requires_morning_availability === "yes") {
    reasons.push("Exige disponibilidad de mañana");
  }

  // Puestos senior.
  if ((preferences.discardSeniority as readonly string[]).includes(e.seniority)) {
    reasons.push(`Puesto ${e.seniority}`);
  }

  // Inglés por encima del nivel real.
  if ((preferences.english.discardLevels as readonly string[]).includes(e.english_level_required)) {
    reasons.push(`Inglés ${e.english_level_required} requerido (nivel del candidato: básico)`);
  }

  return { passed: reasons.length === 0, reasons };
}
