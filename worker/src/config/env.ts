import { z } from "zod";

/**
 * Variables de entorno del worker. Se validan al arrancar; nunca se imprimen.
 * En GitHub Actions llegan desde los Repository Secrets.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY es obligatoria"),
  SUPABASE_URL: z.string().url("SUPABASE_URL debe ser una URL"),
  /** Clave secreta de Supabase (sb_secret_... o la legacy service_role). Solo backend. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY es obligatoria"),
  /** UUID del usuario de Supabase Auth al que pertenecen las ofertas. */
  JOBFINDER_USER_ID: z.string().uuid("JOBFINDER_USER_ID debe ser el UUID del usuario de Supabase Auth"),

  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  /** Esfuerzo de Claude en la fase de búsqueda y en la de evaluación. */
  CLAUDE_SEARCH_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  CLAUDE_EVAL_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  /** Máximo de búsquedas web por lote de consultas (coste: 10 $/1000 búsquedas). */
  MAX_SEARCHES_PER_BATCH: z.coerce.number().int().min(1).max(50).default(10),
  MAX_FETCHES_PER_BATCH: z.coerce.number().int().min(0).max(50).default(12),

  /** Opcional: API oficial de InfoJobs (developer.infojobs.net). */
  INFOJOBS_CLIENT_ID: z.string().optional(),
  INFOJOBS_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** En modo --dry-run no se necesita Supabase. */
const DryRunEnvSchema = EnvSchema.extend({
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  JOBFINDER_USER_ID: z.string().optional().default("00000000-0000-0000-0000-000000000000"),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env, opts: { dryRun?: boolean } = {}): Env {
  // Trata las cadenas vacías (secrets no definidos en Actions) como ausentes.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const schema = opts.dryRun ? DryRunEnvSchema : EnvSchema;
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    // Solo nombres de variables y mensajes; jamás valores.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida:\n- ${problems.join("\n- ")}`);
  }
  return parsed.data as Env;
}
