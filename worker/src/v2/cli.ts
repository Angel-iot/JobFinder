/**
 * CLI de la v2 (NO usa la API de Anthropic):
 *
 *   tsx src/v2/cli.ts collect [--force] [--dry-run]   paso 1: fuentes → filtros → work/
 *   tsx src/v2/cli.ts store   [--dry-run]             paso 3: resultado Claude o respaldo → Supabase
 *   tsx src/v2/cli.ts schema                          imprime el JSON Schema para claude_args
 *
 * El paso 2 (análisis) lo hace claude-code-action en el workflow.
 * --dry-run: sin Supabase (repositorio en memoria); útil para probar las fuentes en local.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { errorMessage, Logger } from "../lib/logger.js";
import { madridDate } from "../lib/time.js";
import { claudeJsonSchemaString } from "./analysisSchema.js";
import { collect } from "./collect.js";
import { assertNoAnthropicApiCredentials, loadEnvV2, type EnvV2 } from "./env.js";
import { readExecutionFile } from "./execution.js";
import { renderSummary } from "./summary.js";
import { InMemoryRepositoryV2, SupabaseRepositoryV2, type JobsRepositoryV2 } from "./repository.js";
import { statePath } from "./state.js";
import { store } from "./store.js";

const DRY_RUN_REPO_FILE = "dry-run-repo.json";

function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  if (value.includes("\n")) {
    const delim = `EOF_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`, "utf8");
  } else {
    appendFileSync(file, `${name}=${value}\n`, "utf8");
  }
}

function makeRepo(env: EnvV2, dryRun: boolean): JobsRepositoryV2 {
  if (!dryRun) return new SupabaseRepositoryV2(env);
  // En --dry-run el repositorio en memoria se conserva entre pasos en work/.
  const repo = new InMemoryRepositoryV2();
  const file = join(env.WORK_DIR, DRY_RUN_REPO_FILE);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    Object.assign(repo, { jobs: saved.jobs, rejections: saved.rejections, runs: new Map(saved.runs) });
  }
  return repo;
}

function persistDryRepo(env: EnvV2, repo: JobsRepositoryV2) {
  if (!(repo instanceof InMemoryRepositoryV2)) return;
  writeFileSync(
    join(env.WORK_DIR, DRY_RUN_REPO_FILE),
    JSON.stringify({ jobs: repo.jobs, rejections: repo.rejections, runs: [...repo.runs.entries()] }, null, 2),
    "utf8",
  );
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");

  if (command === "schema") {
    process.stdout.write(claudeJsonSchemaString() + "\n");
    return 0;
  }

  const runDate = madridDate();
  const log = new Logger({ run_date: runDate, step: command, pipeline: "v2" }, `logs/v2-${runDate}.jsonl`);

  let env: EnvV2;
  try {
    // Defensa en profundidad: la v2 nunca debe tener credenciales de la API de Anthropic.
    assertNoAnthropicApiCredentials();
    env = loadEnvV2(process.env, { dryRun });
  } catch (err) {
    log.error("Configuración inválida", { error: errorMessage(err) });
    setOutput("run_started", "false");
    return 1;
  }
  const repo = makeRepo(env, dryRun);

  if (command === "collect") {
    const force = rest.includes("--force") || process.env.FORCE_RUN === "true";
    const trigger = process.env.GITHUB_EVENT_NAME === "schedule" ? "schedule" : process.env.GITHUB_ACTIONS ? "manual-v2" : "local-v2";
    try {
      const result = await collect({ env, repo, log }, { runDate, trigger, force });
      persistDryRepo(env, repo);
      if (!result.started) {
        setOutput("run_started", "false");
        appendSummary(`## JobFinder v2\nBúsqueda omitida: ${result.reason}\n`);
        return 0;
      }
      setOutput("run_started", "true");
      setOutput("claude_candidates", String(result.claudeCandidates));
      setOutput("json_schema", claudeJsonSchemaString());
      return 0;
    } catch (err) {
      log.error("Error no controlado en collect", { error: errorMessage(err) });
      setOutput("run_started", "false");
      return 1;
    }
  }

  if (command === "store") {
    if (!existsSync(statePath(env.WORK_DIR))) {
      log.error("No existe work/state.json: el paso collect no llegó a ejecutarse");
      return 1;
    }
    const skipped = process.env.CLAUDE_SKIPPED_REASON;
    const claudeSkipped =
      skipped === "no_token" ? "skipped_no_token" : skipped === "by_input" ? "skipped_by_input" : skipped === "no_candidates" ? "skipped_no_candidates" : null;
    const execution = claudeSkipped ? null : readExecutionFile(process.env.CLAUDE_EXECUTION_FILE);
    try {
      const result = await store({ env, repo, log }, { execution, claudeSkipped });
      persistDryRepo(env, repo);
      appendSummary(renderSummary(result.status, result.stats));
      return result.status === "failed" ? 1 : 0;
    } catch (err) {
      log.error("Error no controlado en store", { error: errorMessage(err) });
      return 1;
    }
  }

  log.error("Comando desconocido", { command });
  return 1;
}

function appendSummary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, markdown + "\n", "utf8");
  else console.log(markdown);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(errorMessage(err));
    process.exit(1);
  },
);
