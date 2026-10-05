/** Oferta candidata tal y como sale de una fuente, antes del análisis. */
export interface RawCandidate {
  /** linkedin | infojobs | dominio de la fuente (p. ej. "remoteok.com"). */
  source: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  published_at: string | null;
  /**
   * Toda la información encontrada sobre la oferta (texto de la página o del
   * resultado de búsqueda). Es lo que Claude analizará después.
   */
  details: string;
  /** De dónde salen los detalles: página completa o solo resultado de búsqueda. */
  details_origin: "full_page" | "search_snippet" | "official_api";
  /** Cómo se descubrió. */
  discovered_via: "claude_web_search" | "infojobs_api" | "official_api";
}

export interface SourceStats {
  source: string;
  searches: number;
  fetches: number;
  results: number;
  candidates: number;
  errors: string[];
}
