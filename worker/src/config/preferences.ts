/**
 * PREFERENCIAS Y REGLAS DE BÚSQUEDA.
 *
 * Las reglas duras (filtros) se aplican en código (src/scoring/hardFilters.ts)
 * usando estos valores. Cambia aquí las preferencias; no hace falta tocar la
 * lógica. Ver README → "Cómo cambiar preferencias".
 */

export const preferences = {
  timezone: "Europe/Madrid",

  /** Puestos objetivo (no limitarse a coincidencias exactas del título). */
  targetRoles: [
    "Helpdesk",
    "Service Desk",
    "IT Support",
    "Técnico Informático",
    "Técnico de Sistemas",
    "Sysadmin Junior",
    "Soporte Linux",
  ],
  relatedRoleExamples: [
    "IT Technician",
    "Technical Support",
    "Junior Systems Administrator",
    "Desktop Support",
  ],

  hours: {
    /** 0–idealMax h/semana: ideal. */
    idealMax: 20,
    /** idealMax+1–acceptableMax: posible solo si la oferta es especialmente buena. */
    acceptableMax: 25,
    // > acceptableMax: descartar. Full-time: descartar siempre.
  },

  schedule: {
    /** Hora más temprana a la que se puede empezar a trabajar (HH:MM, hora de Madrid). */
    earliestStart: "16:00",
  },

  remote: {
    /** Solo 100% remoto. Híbrido / presencial / "remoto algunos días" se descartan. */
    required: "full_remote" as const,
    /** Países desde los que se puede trabajar. */
    allowedCountries: ["ES"],
  },

  english: {
    /** Nivel real del candidato. */
    candidateLevel: "basic" as const,
    /** Niveles exigidos que provocan descarte. */
    discardLevels: ["advanced", "fluent", "native"] as const,
    /** Penalización (puntos) por nivel exigido. */
    penalties: { intermediate: 6, upper_intermediate: 15 } as Record<string, number>,
  },

  /** Seniority que se descarta. */
  discardSeniority: ["senior", "lead", "manager"] as const,

  /** Penalización si la oferta no publica salario (pequeña). */
  noSalaryPenalty: 2,

  /** Umbrales de prioridad (0–100). */
  priority: { high: 75, interesting: 55 },

  /** Puntuación mínima para guardar una oferta que ha pasado los filtros duros. */
  minScoreToStore: 35,
} as const;

/**
 * Pesos de la puntuación (suman 100), en el orden de prioridad pedido:
 * 1 horario, 2 remoto, 3 jornada, 4 aprendizaje, 5 encaje ASIR, 6 adecuación
 * del puesto, 7 experiencia, 8 salario, 9 tecnologías, 10 otros.
 * Los filtros duros se aplican ANTES: un salario alto nunca compensa un
 * requisito fundamental incompatible.
 */
export const scoreWeights = {
  schedule: 20,
  remote: 16,
  hours: 15,
  learning: 14,
  asirFit: 10,
  roleFit: 9,
  experience: 7,
  salary: 4,
  technologies: 3,
  other: 2,
} as const;

export type ScoreComponent = keyof typeof scoreWeights;
