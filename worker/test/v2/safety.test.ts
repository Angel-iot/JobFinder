/**
 * Garantías de "0 € de API": la v2 no puede usar la API de Anthropic.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseShellArgs } from "shell-quote";
import { describe, expect, it } from "vitest";
import { claudeJsonSchemaString, ClaudeOutputSchema } from "../../src/v2/analysisSchema.js";
import { assertNoAnthropicApiCredentials } from "../../src/v2/env.js";
import { analysis } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../src");
const REPO = resolve(here, "../../..");
const WORKFLOWS = join(REPO, ".github/workflows");

/** Recorre el grafo de imports relativos desde src/v2 y devuelve los paquetes externos usados. */
function externalImports(entryDir: string): Map<string, string[]> {
  const seen = new Set<string>();
  const externals = new Map<string, string[]>();
  const queue = readdirSync(entryDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(entryDir, f));
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1]!;
      if (spec.startsWith(".")) queue.push(resolve(dirname(file), spec.replace(/\.js$/, ".ts")));
      else externals.set(spec, [...(externals.get(spec) ?? []), file]);
    }
  }
  return externals;
}

describe("la v2 no puede llamar a la API de Anthropic", () => {
  it("ningún módulo alcanzable desde src/v2 importa @anthropic-ai/sdk en tiempo de ejecución", () => {
    const ext = externalImports(join(SRC, "v2"));
    const sdk = [...ext.keys()].filter((k) => k.startsWith("@anthropic-ai/"));
    expect(sdk, `importado desde: ${sdk.map((k) => ext.get(k)).join(", ")}`).toEqual([]);
    // Control positivo: el detector sí encuentra el SDK en el código de la v1.
    expect([...externalImports(join(SRC, "claude")).keys()]).toContain("@anthropic-ai/sdk");
  });

  it("el worker v2 se niega a arrancar con credenciales de API en el entorno", () => {
    expect(() => assertNoAnthropicApiCredentials({ ANTHROPIC_API_KEY: "sk-ant-x" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => assertNoAnthropicApiCredentials({ ANTHROPIC_AUTH_TOKEN: "x" })).toThrow();
    expect(() => assertNoAnthropicApiCredentials({ CLAUDE_CODE_OAUTH_TOKEN: "x" })).not.toThrow();
  });
});

describe("workflows de GitHub", () => {
  const v2 = readFileSync(join(WORKFLOWS, "job-search-v2.yml"), "utf8");

  it("v2: solo ejecución manual (sin cron todavía)", () => {
    expect(v2).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(v2).not.toMatch(/^\s+schedule:/m);
  });

  it("v2: Claude se autentica SOLO con el token de suscripción", () => {
    expect(v2).toContain("claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}");
    expect(v2).not.toMatch(/anthropic_api_key\s*:/);
    // ANTHROPIC_API_KEY solo aparece en la comprobación que detiene el workflow.
    const uses = v2.split("\n").filter((l) => l.includes("ANTHROPIC_API_KEY") && !l.trim().startsWith("#"));
    expect(uses.every((l) => /API_KEY_SECRET_EXISTS|\$\{ANTHROPIC_API_KEY:-\}|::error::|Existe el secret/.test(l))).toBe(true);
  });

  it("v2: el paso de Claude no recibe secretos de Supabase y solo puede leer", () => {
    const step = v2.slice(v2.indexOf("2 · Análisis con Claude"), v2.indexOf("3 · Validar y guardar"));
    expect(step).not.toMatch(/SUPABASE|INFOJOBS|ADZUNA/);
    expect(step).toContain("--allowedTools Read");
    expect(step).toMatch(/--disallowedTools[^\n]*Bash[^\n]*Write[^\n]*WebFetch[^\n]*WebSearch/);
    expect(step).toContain("continue-on-error: true");
    expect(step).toMatch(/anthropics\/claude-code-action@[0-9a-f]{40}/);
  });

  it("ningún workflow combina cron con la API de pago", () => {
    for (const f of readdirSync(WORKFLOWS)) {
      const y = readFileSync(join(WORKFLOWS, f), "utf8");
      const scheduled = /^\s+schedule:/m.test(y);
      const usesApiKey = /secrets\.ANTHROPIC_API_KEY\s*\}\}/.test(y) && !/API_KEY_SECRET_EXISTS/.test(y);
      expect(scheduled && usesApiKey, f).toBe(false);
    }
  });
});

describe("JSON Schema para claude_args", () => {
  it("sobrevive al parseo de claude_args tal y como lo hace claude-code-action", () => {
    const schema = claudeJsonSchemaString();
    const claudeArgs = `--max-turns 30\n--allowedTools Read\n--json-schema '${schema}'\n`;
    // Misma técnica que la acción: escapar ()|&;<> antes de shell-quote y restaurar después.
    // La acción usa puntos de código Unicode de uso privado (invisibles); aquí se usan U+E000..U+E006.
    const META: [string, string][] = ["(", ")", "|", "&", ";", "<", ">"].map((c, i) => [c, String.fromCharCode(0xe000 + i)]);
    const esc = (s: string) => META.reduce((acc, [k, v]) => acc.split(k).join(v), s);
    const unesc = (s: string) => META.reduce((acc, [k, v]) => acc.split(v).join(k), s);
    const args = parseShellArgs(esc(claudeArgs)).map((a) => (typeof a === "string" ? unesc(a) : a));
    const value = args[args.indexOf("--json-schema") + 1] as string;
    expect(JSON.parse(value)).toEqual(JSON.parse(schema));
  });

  it("acepta la salida esperada y no contiene caracteres problemáticos", () => {
    const schema = claudeJsonSchemaString();
    expect(schema).not.toMatch(/['$\n]/);
    expect(ClaudeOutputSchema.safeParse({ analyses: [analysis("c001")] }).success).toBe(true);
  });
});
