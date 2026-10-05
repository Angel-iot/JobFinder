/**
 * Utilidades de fecha en Europe/Madrid. GitHub Actions puede retrasarse;
 * la "fecha del día" siempre se calcula en hora local de Madrid.
 */

const TZ = "Europe/Madrid";

/** Fecha local de Madrid en formato YYYY-MM-DD. */
export function madridDate(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Hora local de Madrid (0–23). */
export function madridHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number(h);
}

/** Convierte "HH:MM" (o "H:MM", "HHhMM", "HH.MM", "HH") a minutos desde medianoche. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*h?$/i);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}
