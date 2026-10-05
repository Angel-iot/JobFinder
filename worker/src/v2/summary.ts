import type { RunStatus } from "../storage/repository.js";
import type { V2Stats } from "./state.js";

const CLAUDE_STATUS: Record<string, string> = {
  ok: "✅ analizó todas",
  partial: "⚠️ análisis parcial (el resto, por código)",
  skipped_no_candidates: "— sin candidatos que analizar",
  skipped_no_token: "⏭️ omitido: falta CLAUDE_CODE_OAUTH_TOKEN (todo por código)",
  skipped_by_input: "⏭️ omitido manualmente (todo por código)",
  usage_limit: "⛔ límite de uso de la suscripción alcanzado (todo por código)",
  failed: "⛔ falló (todo por código)",
  invalid_output: "⛔ salida no válida (todo por código)",
  pending: "?",
};

/** Resumen en Markdown para la página de la ejecución en GitHub Actions. */
export function renderSummary(status: RunStatus, s: V2Stats): string {
  const rows = (pairs: [string, unknown][]) => pairs.map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const sources = Object.entries(s.per_source)
    .map(([name, x]) => `| ${name} | ${x.enabled ? "sí" : "no (sin credenciales)"} | ${x.requests} | ${x.fetched} | ${x.relevant} | ${x.errors} | ${(x.duration_ms / 1000).toFixed(1)} s |`)
    .join("\n");
  const filters = Object.entries(s.discarded_by_filter)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");
  const u = s.claude_usage as Record<string, unknown> | null;

  return `## JobFinder v2 · ${s.run_date}

**Estado:** ${status} · **Duración total:** ${s.duration_s ?? "?"} s · **Claude:** ${CLAUDE_STATUS[s.claude_status] ?? s.claude_status}

### Ofertas por fuente
| Fuente | Activa | Peticiones | Obtenidas | Relevantes | Errores | Tiempo |
|---|---|---|---|---|---|---|
${sources}

### Embudo
| Paso | Nº |
|---|---|
${rows([
  ["Obtenidas (todas las fuentes)", s.candidates_found],
  ["Descartadas por relevancia (puesto ajeno)", s.discarded_relevance],
  ["Únicas tras deduplicar", s.unique_candidates],
  ["Descartadas antes por ti (no vuelven)", s.skipped_dismissed],
  ["Rechazadas en días anteriores", s.skipped_previously_rejected],
  ["Ya conocidas (siguen activas)", s.already_known],
  ["Descartadas por filtros duros", s.discarded_hard_filters],
  ["Pasan los filtros", s.passed_filters],
  ["Enviadas a Claude", s.sent_to_claude],
  ["Analizadas por Claude", s.analyzed_by_claude],
  ["Descartadas tras el análisis de Claude (filtros sobre sus datos)", s.discarded_by_claude_facts],
  ["Descartadas por nota baja (Claude / código)", `${s.discarded_low_score_claude} / ${s.discarded_low_score_code}`],
  ["Guardadas nuevas (Claude / solo código)", `${s.inserted} (${s.inserted_claude} / ${s.inserted_code_only})`],
  ["Guardadas actualizadas · pendientes re-analizadas", `${s.saved_updated} · ${s.upgraded_to_claude}`],
])}

### Descartes por filtro
| Filtro | Nº |
|---|---|
${filters || "| — | 0 |"}

### Consumo de Claude (suscripción)
${
  u
    ? rows([
        ["Modelo", u.model ?? "?"],
        ["Turnos", u.num_turns ?? "?"],
        ["Duración", u.duration_ms ? `${Math.round(Number(u.duration_ms) / 1000)} s` : "?"],
        ["Tokens entrada / salida", `${u.input_tokens ?? "?"} / ${u.output_tokens ?? "?"}`],
        ["Tokens caché (lectura / escritura)", `${u.cache_read_input_tokens ?? "?"} / ${u.cache_creation_input_tokens ?? "?"}`],
        ["Coste equivalente API (NO facturado con suscripción)", u.equivalent_api_cost_usd != null ? `$${Number(u.equivalent_api_cost_usd).toFixed(4)}` : "?"],
        ["Eventos de límite de uso", Array.isArray(u.rate_limit_events) && u.rate_limit_events.length ? JSON.stringify(u.rate_limit_events).slice(0, 300) : "ninguno"],
      ]).replace(/^/, "| Dato | Valor |\n|---|---|\n")
    : "Sin datos (Claude no se ejecutó o no dejó archivo de ejecución)."
}

> El porcentaje de cuota restante del plan Pro no lo expone GitHub ni Claude Code en el archivo de ejecución; se ve en claude.ai/settings/usage.

### Errores (${s.errors.length})
${s.errors.length ? s.errors.slice(0, 30).map((e) => `- ${e.replace(/\n/g, " ")}`).join("\n") : "Ninguno."}
`;
}
