/**
 * Identidad de una oferta para deduplicar:
 *   1. URL canónica (sin parámetros de tracking, formato estable por plataforma).
 *   2. ID externo de la plataforma (LinkedIn / InfoJobs).
 *   3. Huella empresa + título normalizados (detecta la misma oferta en varias fuentes).
 *   4. Hash de contenido (detecta cambios significativos).
 */
import { normalizeText, sha256 } from "../lib/hash.js";

const TRACKING_PARAMS = [
  /^utm_/i,
  /^trk/i,
  /^ref/i,
  /^tracking/i,
  /^source$/i,
  /^src$/i,
  /^origin$/i,
  /^position$/i,
  /^pagenum$/i,
  /^originalsubdomain$/i,
  /^applicationorigin$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_/i,
  /^lipi$/i,
  /^from$/i,
];

export function sourceFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
    if (host === "infojobs.net" || host.endsWith(".infojobs.net")) return "infojobs";
    return host;
  } catch {
    return "unknown";
  }
}

/** ID externo de la plataforma, si se puede extraer de la URL. */
export function externalIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const source = sourceFromUrl(url);
  if (source === "linkedin") {
    const current = u.searchParams.get("currentJobId");
    if (current && /^\d+$/.test(current)) return current;
    // /jobs/view/1234567890 o /jobs/view/titulo-de-la-oferta-1234567890
    const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/);
    return m?.[1] ?? null;
  }
  if (source === "infojobs") {
    // https://www.infojobs.net/valencia/tecnico-helpdesk/of-i0123abcd...
    const m = u.pathname.match(/\/of-i([a-z0-9]+)/i);
    return m?.[1]?.toLowerCase() ?? null;
  }
  return null;
}

export function canonicalizeUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

  const source = sourceFromUrl(u.toString());
  const externalId = externalIdFromUrl(u.toString());
  if (source === "linkedin" && externalId) {
    return `https://www.linkedin.com/jobs/view/${externalId}`;
  }
  if (source === "infojobs" && externalId) {
    // La ruta de InfoJobs contiene provincia y slug; el ID es lo estable.
    return `https://www.infojobs.net/of-i${externalId}`;
  }

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

/** Quita marcadores de género y modalidad del título para comparar entre fuentes. */
export function normalizeTitle(title: string): string {
  return normalizeText(
    title
      .replace(/\((?:m\/f\/d|f\/m\/d|m\/w\/d|h\/m|m\/h|h\/m\/x|m\/f|f\/m|all genders)\)/gi, " ")
      .replace(/\b(?:h\/m|m\/f|f\/m)\b/gi, " "),
  )
    .replace(/\b(100 )?(remote|remoto|teletrabajo|full remote|part time|media jornada|jornada parcial)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(company: string | null | undefined): string {
  return normalizeText(company)
    .replace(/\b(s ?l ?u?|s ?a|sl|sa|slu|ltd|limited|gmbh|inc|llc|bv|srl|sas|group|grupo)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Huella empresa+título. Sin empresa no es fiable: se combina con la URL canónica. */
export function fingerprint(title: string, company: string | null | undefined, canonicalUrl: string): string {
  const c = normalizeCompany(company);
  const t = normalizeTitle(title);
  return sha256(c ? `${c}|${t}` : `nocompany|${t}|${canonicalUrl}`);
}

export interface ContentHashInput {
  title: string;
  company: string | null;
  remote_type: string;
  employment_type: string;
  hours_per_week: number | null;
  schedule: string | null;
  salary_min: number | null;
  salary_max: number | null;
  english_level: string;
  experience_years_min: number | null;
}

/** Hash de los datos que importan; si cambia en una oferta guardada → "actualizada". */
export function contentHash(input: ContentHashInput): string {
  return sha256(
    JSON.stringify([
      normalizeTitle(input.title),
      normalizeCompany(input.company),
      input.remote_type,
      input.employment_type,
      input.hours_per_week,
      normalizeText(input.schedule),
      input.salary_min,
      input.salary_max,
      input.english_level,
      input.experience_years_min,
    ]),
  );
}
