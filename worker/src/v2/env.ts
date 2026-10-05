import { z } from "zod";

/**
 * Variables del worker v2. NO hay ninguna variable de Anthropic: el worker v2
 * nunca llama a Claude. El análisis lo hace claude-code-action en un paso
 * separado del workflow, autenticado con CLAUDE_CODE_OAUTH_TOKEN.
 */
const EnvV2Schema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL debe ser una URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY es obligatoria"),
  JOBFINDER_USER_ID: z.string().uuid("JOBFINDER_USER_ID debe ser el UUID del usuario de Supabase Auth"),

  /** Máximo de ofertas que se envían a Claude por ejecución (protege la cuota de la suscripción). */
  MAX_CLAUDE_CANDIDATES: z.coerce.number().int().min(0).max(100).default(30),
  /** Directorio de trabajo compartido entre los pasos del workflow. */
  WORK_DIR: z.string().default("work"),

  // Fuentes opcionales con credenciales de APLICACIÓN (gratuitas).
  INFOJOBS_CLIENT_ID: z.string().optional(),
  INFOJOBS_CLIENT_SECRET: z.string().optional(),
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
});

export type EnvV2 = z.infer<typeof EnvV2Schema>;

const DryRunSchema = EnvV2Schema.extend({
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  JOBFINDER_USER_ID: z.string().optional().default("00000000-0000-0000-0000-000000000000"),
});

export function loadEnvV2(source: NodeJS.ProcessEnv = process.env, opts: { dryRun?: boolean } = {}): EnvV2 {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = (opts.dryRun ? DryRunSchema : EnvV2Schema).safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Configuración inválida:\n- ${problems.join("\n- ")}`);
  }
  return parsed.data as EnvV2;
}

/**
 * Comprobación de seguridad: el worker v2 se niega a arrancar si encuentra
 * credenciales de la API de Anthropic en el entorno, para que ningún paso
 * pueda acabar facturando por API por accidente.
 */
export function assertNoAnthropicApiCredentials(source: NodeJS.ProcessEnv = process.env): void {
  const found = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"].filter((k) => (source[k] ?? "") !== "");
  if (found.length) {
    throw new Error(
      `Se encontraron credenciales de la API de Anthropic (${found.join(", ")}). ` +
        "La v2 no las usa y no deben estar definidas: elimínalas del entorno/workflow.",
    );
  }
}
