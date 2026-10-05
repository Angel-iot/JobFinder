/**
 * Punto de entrada del buscador diario.
 *
 *   npm run search                 ejecución normal (requiere todas las variables)
 *   npm run search -- --force      repite la búsqueda aunque hoy ya se haya hecho
 *   npm run search:dry             sin Supabase: guarda el resultado en logs/dry-run-<fecha>.json
 *
 * Códigos de salida: 0 = completado / omitido / parcial, 1 = fallo.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "./config/env.js";
import { createClaudeClient } from "./claude/client.js";
import { errorMessage, Logger } from "./lib/logger.js";
import { madridDate } from "./lib/time.js";
import { runDailySearch, summaryForLog, type PipelineResult } from "./pipeline.js";
import { InMemoryRepository, type JobsRepository } from "./storage/repository.js";
import { SupabaseRepository } from "./storage/supabaseRepository.js";

interface Args {
  dryRun: boolean;
  force: boolean;
  trigger: string;
}

function parseArgs(argv: string[]): Args {
  const triggerArg = argv.find((a) => a.startsWith("--trigger="));
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force") || process.env.FORCE_RUN === "true",
    trigger: triggerArg?.split("=")[1] ?? (process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : process.env.GITHUB_ACTIONS ? "manual" : "local"),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const runDate = madridDate();
  const log = new Logger({ run_date: runDate }, `logs/run-${runDate}.jsonl`);

  let env;
  try {
    env = loadEnv(process.env, { dryRun: args.dryRun });
  } catch (err) {
    log.error("Configuración inválida", { error: errorMessage(err) });
    return 1;
  }

  const repo: JobsRepository = args.dryRun ? new InMemoryRepository() : new SupabaseRepository(env);
  log.info("JobFinder arrancando", {
    dry_run: args.dryRun,
    force: args.force,
    trigger: args.trigger,
    model: env.CLAUDE_MODEL,
    infojobs_api: Boolean(env.INFOJOBS_CLIENT_ID && env.INFOJOBS_CLIENT_SECRET),
  });

  let result: PipelineResult;
  try {
    result = await runDailySearch(
      { env, repo, claude: createClaudeClient(env), log },
      { runDate, trigger: args.trigger, force: args.force },
    );
  } catch (err) {
    log.error("Error no controlado", { error: errorMessage(err) });
    return 1;
  }

  if (args.dryRun && repo instanceof InMemoryRepository) {
    const file = `logs/dry-run-${runDate}.json`;
    writeFileSync(file, JSON.stringify({ result, jobs: repo.jobs, rejections: repo.rejections }, null, 2), "utf8");
    log.info("Resultado de prueba guardado", { file });
  }

  writeStepSummary(result);
  if (result.kind === "skipped") return 0;
  return result.status === "failed" ? 1 : 0;
}

/** Resumen visible en la página del workflow de GitHub Actions. */
function writeStepSummary(result: PipelineResult) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines: string[] = ["## JobFinder"];
  if (result.kind === "skipped") {
    lines.push(`Búsqueda omitida: ${result.reason}`);
  } else {
    const s = summaryForLog(result.stats);
    lines.push(`**Estado:** ${result.status}`, "", "| Métrica | Valor |", "|---|---|");
    for (const [k, v] of Object.entries(s)) lines.push(`| ${k} | ${typeof v === "object" ? JSON.stringify(v) : v} |`);
    if (result.errors.length) {
      lines.push("", "### Errores", ...result.errors.slice(0, 30).map((e) => `- ${e.replace(/\n/g, " ")}`));
    }
  }
  appendFileSync(file, lines.join("\n") + "\n", "utf8");
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(errorMessage(err));
    process.exit(1);
  },
);
