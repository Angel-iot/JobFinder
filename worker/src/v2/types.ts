import type { RawCandidate } from "../sources/types.js";

/**
 * Datos estructurados que la PROPIA fuente aporta (campos de su API).
 * Tienen prioridad sobre lo que se deduzca del texto. null = la fuente no lo dice.
 */
export interface SourceHints {
  employment_type: "part_time" | "full_time" | "internship" | "freelance" | null;
  /** La fuente es un portal de empleo 100% remoto o marca la oferta como remota. */
  remote_board: boolean;
  /** Texto de restricción geográfica tal como lo da la fuente ("Worldwide", "USA", "Spain"...). */
  location_restriction: string | null;
  /** La propia búsqueda ya garantiza que admite España (p. ej. Himalayas country=ES). */
  spain_allowed_by_query: boolean;
  seniority: string[];
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: "hour" | "month" | "year" | null;
  /** Texto de jornada/horario que da la fuente (p. ej. InfoJobs "Parcial - Tarde"). */
  workday_text: string | null;
}

export interface V2Candidate extends RawCandidate {
  /** Nombre de la API de origen (para métricas). */
  api: SourceName;
  hints: SourceHints;
}

export type SourceName = "infojobs_api" | "adzuna" | "himalayas" | "remotive" | "remoteok" | "arbeitnow";

export interface SourceResult {
  source: SourceName;
  enabled: boolean;
  requests: number;
  fetched: number;
  candidates: V2Candidate[];
  errors: string[];
  duration_ms: number;
}

export function emptyHints(overrides: Partial<SourceHints> = {}): SourceHints {
  return {
    employment_type: null,
    remote_board: false,
    location_restriction: null,
    spain_allowed_by_query: false,
    seniority: [],
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    workday_text: null,
    ...overrides,
  };
}
