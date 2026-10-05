import type { Job } from "./types";

/** Textos de la tarjeta. Nunca se inventan datos: si falta, "no especificado". */

export function remoteLabel(job: Pick<Job, "remote_type" | "remote_scope" | "remote_location_ambiguous">): string {
  switch (job.remote_type) {
    case "full_remote":
      return job.remote_location_ambiguous
        ? `100% remoto · ubicación ambigua${job.remote_scope ? ` (${job.remote_scope})` : ""}`
        : `100% remoto${job.remote_scope ? ` · ${job.remote_scope}` : ""}`;
    case "hybrid":
      return "Híbrido";
    case "onsite":
      return "Presencial";
    default:
      return "Modalidad no especificada";
  }
}

export function hoursLabel(job: Pick<Job, "hours_per_week" | "employment_type">): string {
  if (job.hours_per_week !== null) return `${formatNumber(job.hours_per_week)} h/semana`;
  if (job.employment_type === "part_time") return "Media jornada (horas no especificadas)";
  if (job.employment_type === "internship") return "Prácticas (horas no especificadas)";
  if (job.employment_type === "freelance") return "Freelance (horas no especificadas)";
  return "Jornada no especificada";
}

export function scheduleLabel(job: Pick<Job, "schedule">): string {
  return job.schedule?.trim() || "Horario no especificado";
}

const PERIOD: Record<string, string> = { hour: "/hora", month: "/mes", year: "/año" };

export function salaryLabel(
  job: Pick<Job, "salary_min" | "salary_max" | "salary_currency" | "salary_period" | "salary_text">,
): string {
  const { salary_min: min, salary_max: max } = job;
  if (min === null && max === null) return job.salary_text?.trim() || "Salario no especificado";
  const cur = job.salary_currency === "EUR" || !job.salary_currency ? "€" : ` ${job.salary_currency}`;
  const period = job.salary_period ? PERIOD[job.salary_period] : "";
  const range = min !== null && max !== null && min !== max
    ? `${formatNumber(min)}–${formatNumber(max)}`
    : formatNumber((min ?? max)!);
  return `${range}${cur}${period}`;
}

export function experienceLabel(job: Pick<Job, "experience_required">): string {
  return job.experience_required?.trim() || "Experiencia no especificada";
}

export function locationLabel(job: Pick<Job, "location">): string {
  return job.location?.trim() || "Ubicación no especificada";
}

export function sourceLabel(source: string): string {
  if (source === "linkedin") return "LinkedIn";
  if (source === "infojobs") return "InfoJobs";
  return source;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(n);
}

/** Fecha local de Madrid (YYYY-MM-DD). */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, d!)),
  );
}

export function shortDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(iso));
}
