import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../config/env.js";

/**
 * Fallback del lado del servidor: si los clasificadores de seguridad rechazan
 * una petición, la API la reintenta en el modelo recomendado para esa
 * categoría. Es opcional (opt-in) y no cambia nada en el caso normal.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createClaudeClient(env: Env): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 4,
    timeout: 15 * 60 * 1000, // ms; las búsquedas largas pueden tardar varios minutos
  });
}

type BetaBlock = Anthropic.Beta.Messages.BetaContentBlock;

/**
 * Prepara el contenido del asistente para reenviarlo en el siguiente turno.
 * Si hubo un fallback a mitad de respuesta, la documentación indica omitir
 * thinking / tool_use / server_tool_use sin resultado anteriores al último
 * bloque `fallback`.
 */
export function contentForEcho(content: BetaBlock[]): Anthropic.Beta.Messages.BetaContentBlockParam[] {
  const lastFallback = content.map((b) => b.type as string).lastIndexOf("fallback");
  if (lastFallback === -1) return content as Anthropic.Beta.Messages.BetaContentBlockParam[];

  const resultIds = new Set(
    content
      .filter((b) => "tool_use_id" in b)
      .map((b) => (b as { tool_use_id: string }).tool_use_id),
  );
  return content.filter((b, i) => {
    if (i >= lastFallback) return true;
    const type = b.type as string;
    if (type === "thinking" || type === "redacted_thinking" || type === "tool_use") return false;
    if (type === "server_tool_use") return resultIds.has((b as { id: string }).id);
    return true;
  }) as Anthropic.Beta.Messages.BetaContentBlockParam[];
}

/** Errores que no se arreglan reintentando con otro lote (clave inválida, sin permisos). */
export function isFatalApiError(err: unknown): boolean {
  return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude: API key inválida o sin permisos (401)";
  if (err instanceof Anthropic.PermissionDeniedError) return "Claude: permiso denegado (403)";
  if (err instanceof Anthropic.RateLimitError) return "Claude: límite de uso alcanzado (429)";
  if (err instanceof Anthropic.BadRequestError) return `Claude: petición inválida (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Claude: error de conexión";
  if (err instanceof Anthropic.APIError) return `Claude: error ${err.status ?? "?"}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
