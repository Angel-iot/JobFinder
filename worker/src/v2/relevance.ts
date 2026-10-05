/**
 * Filtro de relevancia por código: descarta ofertas claramente ajenas al
 * perfil (desarrollo de software, ventas, marketing...) para no enviar a
 * Claude cientos de ofertas irrelevantes de los portales generalistas.
 *
 * Es deliberadamente amplio: no exige coincidencia exacta del título.
 */
import { normalizeText } from "../lib/hash.js";

/** Títulos que por sí solos indican un puesto del perfil. */
const STRONG_TITLE = [
  /\bhelp ?desk\b/,
  /\bservice ?desk\b/,
  /\bit support\b/,
  /\btechnical support\b/,
  /\btech support\b/,
  /\bdesktop support\b/,
  /\bend ?user support\b/,
  /\bit (?:technician|specialist|analyst|administrator|operations|assistant)\b/,
  /\bsupport (?:technician|engineer)\b/,
  /\bsys ?admin\b/,
  /\bsystems? (?:administrator|admin|engineer|technician)\b/,
  /\bnetwork (?:administrator|technician|support)\b/,
  /\blinux\b/,
  /\btecnico (?:informatico|de sistemas|de soporte|it|helpdesk|microinformatico|de redes)\b/,
  /\bsoporte (?:tecnico|informatico|it|n1|n2|de sistemas|a usuarios)\b/,
  /\badministrador de sistemas\b/,
  /\bmicroinformatica\b/,
  /\b(?:n1|n2|nivel 1|nivel 2|level 1|level 2|tier 1|tier 2)\b/,
  /\bit[- ]support\b/,
  /\bsystemadministrator\b/,
];

/** Títulos claramente fuera del perfil (aunque contengan "support" o "técnico"). */
const EXCLUDED_TITLE = [
  /\b(?:software|frontend|front end|backend|back end|full ?stack|mobile|ios|android|web|game|qa|test|data|ml|machine learning|ai)\s+(?:engineer|developer|scientist|analyst)\b/,
  /\b(?:developer|desarrollador|programador|programmer)\b/,
  /\b(?:marketing|sales|ventas|comercial|account executive|account manager|business development|recruiter|recruiting|talent)\b/,
  /\b(?:copywriter|writer|content|designer|disenador|illustrator|video|editor)\b/,
  /\b(?:accountant|contable|bookkeep|finance|financial|legal|lawyer|abogado|nurse|enfermer|doctor|medical|teacher|profesor|tutor)\b/,
  /\b(?:product manager|project manager|scrum master|product owner)\b/,
  /\b(?:customer success|onboarding specialist|virtual assistant|data entry)\b/,
];

/** Palabras de soporte/sistemas para decidir títulos genéricos ("Support Specialist", "Técnico"). */
const IT_CONTEXT = [
  "windows", "linux", "hardware", "software", "troubleshoot", "incidencias", "incidencia", "tickets", "ticketing",
  "active directory", "office 365", "microsoft 365", "m365", "redes", "network", "servidores", "servers",
  "helpdesk", "help desk", "service desk", "itil", "sistemas", "dns", "dhcp", "vpn", "impresoras", "printers",
  "equipos informaticos", "puestos de trabajo", "end users", "usuarios finales", "intune", "jira service",
];

export interface RelevanceResult {
  relevant: boolean;
  reason: string;
}

export function assessRelevance(title: string, details: string): RelevanceResult {
  const t = normalizeText(title);
  if (EXCLUDED_TITLE.some((re) => re.test(t))) return { relevant: false, reason: "Puesto fuera del perfil (por el título)" };
  if (STRONG_TITLE.some((re) => re.test(t))) return { relevant: true, reason: "Título de soporte/sistemas" };

  const generic = /\b(support|soporte|tecnico|technician|it|sistemas|systems|infraestructura|infrastructure|operations|operaciones)\b/.test(t);
  if (!generic) return { relevant: false, reason: "Puesto fuera del perfil (por el título)" };

  const text = normalizeText(details);
  const hits = IT_CONTEXT.filter((k) => text.includes(k)).length;
  return hits >= 3
    ? { relevant: true, reason: `Título genérico con ${hits} términos IT en la descripción` }
    : { relevant: false, reason: "Título genérico sin contexto de IT/soporte" };
}
