import type { RawCandidate } from "../sources/types.js";
import { canonicalizeUrl, externalIdFromUrl, fingerprint, sourceFromUrl } from "./identity.js";

export interface IdentifiedCandidate extends RawCandidate {
  canonical_url: string;
  external_id: string | null;
  fingerprint: string;
  /** Otras URLs donde apareció la misma oferta en esta ejecución. */
  alternate_urls: string[];
}

const SOURCE_RANK = (source: string) => (source === "linkedin" ? 0 : source === "infojobs" ? 1 : 2);
const ORIGIN_RANK = { official_api: 0, full_page: 1, search_snippet: 2 } as const;

export function identify(c: RawCandidate): IdentifiedCandidate {
  const canonical = canonicalizeUrl(c.url);
  return {
    ...c,
    // La fuente se deriva siempre de la URL: es más fiable que lo que diga el modelo.
    source: sourceFromUrl(canonical),
    canonical_url: canonical,
    external_id: externalIdFromUrl(canonical),
    fingerprint: fingerprint(c.title, c.company, canonical),
    alternate_urls: [],
  };
}

/** ¿Cuál de las dos versiones de la misma oferta conservar como principal? */
function better(a: IdentifiedCandidate, b: IdentifiedCandidate): IdentifiedCandidate {
  const byOrigin = ORIGIN_RANK[a.details_origin] - ORIGIN_RANK[b.details_origin];
  if (byOrigin !== 0) return byOrigin < 0 ? a : b;
  const bySource = SOURCE_RANK(a.source) - SOURCE_RANK(b.source);
  if (bySource !== 0) return bySource < 0 ? a : b;
  return a.details.length >= b.details.length ? a : b;
}

function merge(a: IdentifiedCandidate, b: IdentifiedCandidate): IdentifiedCandidate {
  const main = better(a, b);
  const other = main === a ? b : a;
  const urls = new Set([...main.alternate_urls, ...other.alternate_urls, other.canonical_url]);
  urls.delete(main.canonical_url);
  return {
    ...main,
    company: main.company ?? other.company,
    location: main.location ?? other.location,
    published_at: main.published_at ?? other.published_at,
    details:
      other.details && !main.details.includes(other.details.slice(0, 80))
        ? `${main.details}\n\n[Información adicional de ${other.source}]\n${other.details}`.slice(0, 8000)
        : main.details,
    alternate_urls: [...urls],
  };
}

/** Elimina duplicados dentro de una misma ejecución. */
export function dedupeCandidates(candidates: RawCandidate[]): IdentifiedCandidate[] {
  const result: IdentifiedCandidate[] = [];
  for (const raw of candidates) {
    if (!raw.url || !raw.title) continue;
    const c = identify(raw);
    const idx = result.findIndex((r) => sameJob(r, c));
    if (idx === -1) result.push(c);
    else result[idx] = merge(result[idx]!, c);
  }
  return result;
}

export interface JobKey {
  canonical_url: string;
  source: string;
  external_id: string | null;
  fingerprint: string;
  alternate_urls?: string[];
}

export function sameJob(a: JobKey, b: JobKey): boolean {
  if (a.canonical_url === b.canonical_url) return true;
  if (a.alternate_urls?.includes(b.canonical_url) || b.alternate_urls?.includes(a.canonical_url)) return true;
  if (a.external_id && b.external_id && a.source === b.source && a.external_id === b.external_id) return true;
  return a.fingerprint === b.fingerprint;
}

/** Busca una oferta ya conocida (en BD) que corresponda al candidato. */
export function findExisting<T extends JobKey>(candidate: JobKey, existing: T[]): T | undefined {
  return existing.find((e) => sameJob(e, candidate));
}

