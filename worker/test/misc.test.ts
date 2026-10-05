import { describe, expect, it } from "vitest";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DiscoverySubmissionSchema, EvaluationBatchSchema, submitCandidatesTool } from "../src/claude/schemas.js";
import { loadEnv } from "../src/config/env.js";
import { renderProfileForPrompt } from "../src/config/profile.js";
import { DISCOVERY_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT } from "../src/claude/prompts.js";
import { redact } from "../src/lib/logger.js";
import { madridDate, madridHour, parseClock } from "../src/lib/time.js";
import { infojobsDetailsText } from "../src/sources/infojobsApi.js";
import { evaluation } from "./fixtures.js";

describe("fecha y hora de Madrid", () => {
  it("usa la fecha local de Madrid aunque en UTC sea otro día", () => {
    // 23:30 UTC del 5 oct = 01:30 del 6 oct en Madrid (CEST, UTC+2)
    expect(madridDate(new Date("2026-10-05T23:30:00Z"))).toBe("2026-10-06");
    // Invierno (CET, UTC+1): 10:00 UTC = 11:00 Madrid
    expect(madridHour(new Date("2026-01-15T10:00:00Z"))).toBe(11);
    // Verano (CEST, UTC+2): 09:00 UTC = 11:00 Madrid
    expect(madridHour(new Date("2026-07-15T09:00:00Z"))).toBe(11);
  });

  it("parsea horas", () => {
    expect(parseClock("16:00")).toBe(960);
    expect(parseClock("9:30")).toBe(570);
    expect(parseClock("18h")).toBe(1080);
    expect(parseClock("tarde")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
});

describe("seguridad de logs", () => {
  it("redacta claves conocidas y valores de variables secretas", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-api03-supersecret" } as NodeJS.ProcessEnv;
    const out = redact("key=sk-ant-api03-supersecret token sb_secret_abcdef Basic dXNlcjpwYXNz", env);
    expect(out).not.toMatch(/supersecret|sb_secret_abcdef|dXNlcjpwYXNz/);
  });
});

describe("configuración", () => {
  it("falla con un mensaje claro sin revelar valores", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-ant-zzz" })).toThrow(/SUPABASE_URL/);
    try {
      loadEnv({ ANTHROPIC_API_KEY: "sk-ant-zzz" });
    } catch (e) {
      expect(String(e)).not.toContain("sk-ant-zzz");
    }
  });

  it("modo prueba no necesita Supabase", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "x" }, { dryRun: true });
    expect(env.CLAUDE_MODEL).toBe("claude-opus-5-5");
  });

  it("trata secretos vacíos como ausentes", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "x", INFOJOBS_CLIENT_ID: "" }, { dryRun: true });
    expect(env.INFOJOBS_CLIENT_ID).toBeUndefined();
  });
});

describe("perfil y prompts", () => {
  it("el perfil no exagera conocimientos ni idiomas", () => {
    const text = renderProfileForPrompt();
    expect(text).toContain("Inglés básico");
    expect(text).toContain("Python: no");
    expect(text).toContain("SQL: no");
    expect(text).toContain("Docker: básico");
    expect(text).toContain("Vithas (4 meses)");
  });

  it("los prompts de sistema son deterministas (prompt caching)", () => {
    expect(DISCOVERY_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(EVALUATION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(EVALUATION_SYSTEM_PROMPT).toContain("NO INVENTAR");
  });
});

describe("esquemas JSON", () => {
  it("el esquema de evaluación se convierte a formato de structured outputs", () => {
    const format = betaZodOutputFormat(EvaluationBatchSchema);
    expect(format.type).toBe("json_schema");
    expect(JSON.stringify(format.schema)).toContain("remote_allows_spain");
  });

  it("valida una evaluación correcta y rechaza una incorrecta", () => {
    expect(EvaluationBatchSchema.safeParse({ evaluations: [evaluation()] }).success).toBe(true);
    expect(EvaluationBatchSchema.safeParse({ evaluations: [{ ...evaluation(), remote_type: "a veces" }] }).success).toBe(false);
  });

  it("la herramienta de entrega y su validación coinciden", () => {
    const props = Object.keys(submitCandidatesTool.input_schema.properties.candidates.items.properties).sort();
    const zodKeys = Object.keys(DiscoverySubmissionSchema.shape.candidates.element.shape).sort();
    expect(props).toEqual(zodKeys);
  });
});

describe("InfoJobs API", () => {
  it("solo incluye campos presentes (no inventa)", () => {
    const text = infojobsDetailsText(
      { id: "1", title: "Helpdesk", teleworking: { id: 1, value: "Solo teletrabajo" }, workDay: { value: "Parcial - Tarde" } },
      null,
    );
    expect(text).toContain("Teletrabajo: Solo teletrabajo");
    expect(text).toContain("Jornada: Parcial - Tarde");
    expect(text).not.toMatch(/Salario|Horario/);
  });
});

describe("reenvío de contenido del asistente", () => {
  it("sin fallback se reenvía tal cual; con fallback se omiten bloques previos no válidos", async () => {
    const { contentForEcho } = await import("../src/claude/client.js");
    const plain = [{ type: "text", text: "hola" }] as never[];
    expect(contentForEcho(plain)).toBe(plain);
    const mixed = [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "server_tool_use", id: "srv1", name: "web_search", input: {} },
      { type: "web_search_tool_result", tool_use_id: "srv1", content: [] },
      { type: "server_tool_use", id: "srv2", name: "web_search", input: {} },
      { type: "text", text: "parcial" },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "", signature: "y" },
    ] as never[];
    const types = contentForEcho(mixed).map((b) => (b as { type: string; id?: string }).id ?? (b as { type: string }).type);
    expect(types).toEqual(["srv1", "web_search_tool_result", "text", "fallback", "thinking"]);
  });
});
