import { z } from "zod";

// ---------------------------------------------------------------------------
// Fase de búsqueda: Claude entrega las ofertas encontradas con la herramienta
// `submit_job_candidates` (tool estricta). Validamos de nuevo con zod.
// ---------------------------------------------------------------------------

export const DiscoveredJobSchema = z.object({
  url: z.string().min(8),
  title: z.string().min(2),
  company: z.string().nullable(),
  location: z.string().nullable(),
  published_at: z.string().nullable(),
  details: z.string(),
  details_origin: z.enum(["full_page", "search_snippet"]),
});

export const DiscoverySubmissionSchema = z.object({
  candidates: z.array(DiscoveredJobSchema),
});

export type DiscoveredJob = z.infer<typeof DiscoveredJobSchema>;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const submitCandidatesTool = {
  name: "submit_job_candidates",
  description:
    "Entrega las ofertas de empleo concretas encontradas. Llámala una o varias veces durante la búsqueda " +
    "(por ejemplo tras cada grupo de búsquedas). Incluye SOLO ofertas individuales con URL propia, nunca " +
    "páginas de listados genéricos ni artículos. No inventes ningún dato: usa null si algo no aparece.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "title", "company", "location", "published_at", "details", "details_origin"],
          properties: {
            url: { type: "string", description: "URL directa de la oferta individual, tal cual apareció en los resultados." },
            title: { type: "string", description: "Título exacto de la oferta." },
            company: { ...nullableString, description: "Empresa, o null si no aparece." },
            location: { ...nullableString, description: "Ubicación tal como aparece, o null." },
            published_at: {
              ...nullableString,
              description: "Fecha de publicación (YYYY-MM-DD) si aparece explícitamente; si no, null.",
            },
            details: {
              type: "string",
              description:
                "TODA la información encontrada sobre la oferta, copiada o resumida fielmente (modalidad, " +
                "horas, horario, salario, requisitos, idiomas, experiencia, formación, tecnologías, " +
                "beneficios). Máx. ~3000 caracteres. Si solo se vio el resultado de búsqueda, copia el fragmento.",
            },
            details_origin: {
              type: "string",
              enum: ["full_page", "search_snippet"],
              description: "full_page si se leyó la página de la oferta; search_snippet si solo el resultado de búsqueda.",
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Fase de análisis: extracción estructurada + valoración subjetiva.
// Los filtros duros y la puntuación final se calculan en código.
// ---------------------------------------------------------------------------

export const TriState = z.enum(["yes", "no", "unknown"]);

export const JobEvaluationSchema = z.object({
  candidate_index: z.number().int().describe("Índice del candidato en la lista recibida."),
  is_individual_job_offer: z
    .boolean()
    .describe("false si es un listado, un artículo, una oferta ya cerrada o no es una oferta de empleo."),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),

  remote_type: z
    .enum(["full_remote", "hybrid", "onsite", "unknown"])
    .describe("full_remote solo si es 100% remoto. 'Remoto algunos días' = hybrid."),
  remote_scope: z.string().nullable().describe("Desde dónde se puede trabajar, literal (p. ej. 'Remote Spain', 'EU')."),
  remote_allows_spain: TriState.describe(
    "yes solo si consta que se puede trabajar desde España. 'Remote Europe' sin más = unknown.",
  ),

  employment_type: z.enum(["part_time", "full_time", "internship", "freelance", "unknown"]),
  hours_per_week: z.number().nullable().describe("Horas semanales si constan; si no, null. Media jornada sin horas = null."),
  schedule: z.string().nullable().describe("Horario literal si consta; si no, null."),
  schedule_start: z.string().nullable().describe("Hora de inicio HH:MM (24h, hora de España) si consta; si no, null."),
  schedule_end: z.string().nullable().describe("Hora de fin HH:MM si consta; si no, null."),
  requires_morning_availability: TriState.describe(
    "yes si exige trabajar antes de las 16:00 (mañanas, turnos rotativos con mañana, 9-14...).",
  ),
  afternoon_schedule_confirmed: z
    .boolean()
    .describe("true solo si la oferta indica explícitamente turno/jornada de tarde o un horario que empieza a las 16:00 o después."),

  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable().describe("Código ISO (EUR, GBP...) o null."),
  salary_period: z.enum(["hour", "month", "year"]).nullable(),
  salary_text: z.string().nullable().describe("Salario literal tal como aparece, o null."),

  experience_required: z.string().nullable().describe("Experiencia exigida literal, o null."),
  experience_years_min: z.number().nullable(),
  education_required: z.string().nullable(),
  english_level_required: z
    .enum(["none", "basic", "intermediate", "upper_intermediate", "advanced", "fluent", "native", "unknown"])
    .describe("B1=intermediate, B2=upper_intermediate, C1/C2=advanced. 'none' si la oferta no pide inglés explícitamente pero es en español; 'unknown' si no se puede saber."),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead", "manager", "unknown"]),

  technologies: z.array(z.string()),
  requirements: z.array(z.string()).describe("Requisitos importantes, literal y breve."),
  training_info: z.string().nullable().describe("Formación interna, mentoría, plan de formación... literal; null si no se menciona."),
  growth_info: z.string().nullable().describe("Crecimiento / desarrollo profesional; null si no se menciona."),

  summary: z.string().describe("Resumen de 1-3 frases en español."),
  match_reasons: z.array(z.string()).describe("'Por qué encaja': viñetas cortas en español, solo hechos de la oferta."),
  red_flags: z.array(z.string()).describe("'Posibles problemas': viñetas cortas en español (incluye datos no especificados relevantes)."),

  assessment: z.object({
    learning: z.number().int().describe("0-100: potencial de aprendizaje/formación para un estudiante de ASIR."),
    asir_fit: z.number().int().describe("0-100: encaje con la formación SMR + ASIR en curso."),
    role_fit: z.number().int().describe("0-100: adecuación del puesto (helpdesk, soporte, sistemas junior...)."),
    technologies: z.number().int().describe("0-100: encaje con los conocimientos técnicos reales del perfil."),
    other: z.number().int().describe("0-100: otros factores (empresa, condiciones, claridad de la oferta)."),
  }),
  assessment_notes: z.string().describe("Justificación breve de la valoración subjetiva."),
});

export const EvaluationBatchSchema = z.object({
  evaluations: z.array(JobEvaluationSchema),
});

export type JobEvaluation = z.infer<typeof JobEvaluationSchema>;
