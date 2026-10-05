/**
 * Extracción de datos POR CÓDIGO (sin IA) a partir de los campos de la API y
 * del texto de la oferta. Solo se marca un dato cuando aparece de forma
 * explícita; si no, queda como desconocido (null / "unknown").
 *
 * Estos datos alimentan los filtros duros, que se aplican ANTES de Claude.
 */
import type { JobEvaluation } from "../claude/schemas.js";
import type { SourceHints, V2Candidate } from "./types.js";

export type Tri = "yes" | "no" | "unknown";

export interface CodeFacts {
  remote_type: JobEvaluation["remote_type"];
  remote_allows_spain: Tri;
  remote_scope: string | null;
  employment_type: JobEvaluation["employment_type"];
  hours_per_week: number | null;
  schedule: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  requires_morning_availability: Tri;
  afternoon_schedule_confirmed: boolean;
  seniority: JobEvaluation["seniority"];
  english_level_required: JobEvaluation["english_level_required"];
  /** Otro idioma exigido con nivel alto (alemán, francés...), si consta. */
  other_language_required: string | null;
  experience_years_min: number | null;
  experience_required: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: JobEvaluation["salary_period"];
  /** Señales de formación/mentoría encontradas (literal). */
  training_signals: string[];
  technologies: string[];
  /** Evidencias (fragmentos) que justifican cada dato, para logs y para Claude. */
  evidence: Record<string, string>;
}

const OPTIONAL_CONTEXT = /(valorable|deseable|se valorar[aá]|nice[- ]to[- ]have|a plus|is a plus|bonus|preferred|preferible|ideally)/i;

function windowAround(text: string, index: number, radius = 80) {
  return text.slice(Math.max(0, index - radius), index + radius);
}

function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (h: string, m?: string) => `${pad(Number(h))}:${pad(Number(m ?? 0))}`;

// --------------------------------------------------------------- modalidad

const HYBRID_PATTERNS = [
  /\bh[ií]brid[oa]s?\b/i,
  /\bhybrid\b/i,
  /\b\d\s*d[ií]as?\s*(?:a la semana\s*)?(?:en|de)\s*(?:la\s*)?(?:oficina|presencial)/i,
  /\b\d\s*days?\s*(?:per week\s*|a week\s*)?(?:in|at)\s*(?:the\s*)?office\b/i,
  /\bremoto\s+(?:algunos|parcial|\d)\s*d[ií]as?\b/i,
];
const ONSITE_PATTERNS = [
  /\b(?:trabajo|puesto|modalidad|jornada)\s+presencial\b/i,
  /\b100\s*%\s*presencial\b/i,
  /\bon[- ]?site\s+(?:only|position|role|work)\b/i,
  /\bin[- ]office\s+(?:only|position|role)\b/i,
  /\bnot\s+(?:a\s+)?remote\b/i,
];
const FULL_REMOTE_PATTERNS = [
  /\b100\s*%\s*(?:remot|teletrabaj|remote)/i,
  /\bfull(?:y|[- ])\s*remote\b/i,
  /\bremote[- ]first\b/i,
  /\bteletrabajo\s+(?:completo|total|100)/i,
  /\bsolo teletrabajo\b/i,
  /\b(?:trabajo|puesto|posici[oó]n)\s+(?:en\s+)?remoto\b/i,
  /\b(?:this is a|fully|completely)\s+remote\s+(?:role|position|job)\b/i,
];

function detectRemote(text: string, hints: SourceHints): { remote_type: CodeFacts["remote_type"]; evidence?: string } {
  const hybrid = firstMatch(text, HYBRID_PATTERNS);
  if (hybrid) return { remote_type: "hybrid", evidence: windowAround(text, hybrid.index, 50) };
  const onsite = firstMatch(text, ONSITE_PATTERNS);
  if (onsite && !hints.remote_board) return { remote_type: "onsite", evidence: windowAround(text, onsite.index, 50) };
  if (hints.remote_board) return { remote_type: "full_remote", evidence: "La fuente marca la oferta como remota" };
  const remote = firstMatch(text, FULL_REMOTE_PATTERNS);
  if (remote) return { remote_type: "full_remote", evidence: windowAround(text, remote.index, 50) };
  return { remote_type: "unknown" };
}

// ------------------------------------------------------- ubicación remota

const SPAIN_OK = /\b(spain|españa|espana|worldwide|anywhere|global|world ?wide|todo el mundo|cualquier (lugar|pa[ií]s))\b/i;
const EUROPE_AMBIGUOUS = /\b(europe|europa|eu|emea|eea|cet|cest|european union|uni[oó]n europea|western europe)\b/i;

export function classifyLocationRestriction(value: string | null | undefined): Tri {
  if (!value || !value.trim()) return "unknown";
  if (SPAIN_OK.test(value)) return "yes";
  if (EUROPE_AMBIGUOUS.test(value)) return "unknown";
  return "no"; // menciona otro(s) país(es)/región(es) que no incluyen España
}

// ------------------------------------------------------------------ jornada

function detectEmployment(text: string, hints: SourceHints): CodeFacts["employment_type"] {
  if (hints.employment_type) return hints.employment_type;
  const part = /\b(media jornada|jornada parcial|tiempo parcial|part[- ]?time|teilzeit)\b/i.test(text);
  const full = /\b(jornada completa|tiempo completo|full[- ]?time|vollzeit)\b/i.test(text);
  if (part && !full) return "part_time";
  if (full && !part) return "full_time";
  if (/\b(pr[aá]cticas|becario|internship|intern)\b/i.test(text)) return "internship";
  if (/\b(freelance|aut[oó]nomo|contractor)\b/i.test(text)) return "freelance";
  return "unknown";
}

const HOURS_PATTERNS = [
  /\b(\d{1,2}(?:[.,]5)?)\s*(?:-|a|to|–)\s*(\d{1,2}(?:[.,]5)?)\s*(?:h|hrs?|horas|hours)\b\s*(?:\/|a la|por|per|each|semanales|weekly|a week)\s*(?:semana|week)?/i,
  /\b(\d{1,2}(?:[.,]5)?)\s*(?:h|hrs?|horas|hours|stunden)\b\s*(?:\/\s*|a la |por |per |each |a )?\s*(?:semana(?:les)?|week|weekly|semanales|woche)\b/i,
  /\b(\d{1,2})\s*horas\s+semanales\b/i,
];

function detectHours(text: string): { hours: number | null; evidence?: string } {
  const m = firstMatch(text, HOURS_PATTERNS);
  if (!m) return { hours: null };
  const nums = [m[1], m[2]].filter(Boolean).map((n) => Number(n!.replace(",", ".")));
  const hours = Math.max(...nums);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 60) return { hours: null };
  return { hours, evidence: m[0] };
}

// ------------------------------------------------------------------ horario

const RANGE_PATTERNS = [
  /\b(\d{1,2})[:.](\d{2})\s*h?\s*(?:-|–|a|to|hasta)\s*(\d{1,2})[:.](\d{2})\s*h?\b/i,
  /\bde\s+(\d{1,2})\s*h?\s*a\s+(\d{1,2})\s*h\b/i,
  /\bfrom\s+(\d{1,2})\s*(am|pm)\s*to\s+(\d{1,2})\s*(am|pm)\b/i,
];
const MORNING = /\b(turno de ma[ñn]ana|horario de ma[ñn]ana|por las ma[ñn]anas|jornada intensiva de ma[ñn]ana|intensiva\s*-\s*ma[ñn]ana|parcial\s*-\s*ma[ñn]ana|morning shift|turnos rotativos|rotating shifts|disponibilidad (?:de|por las) ma[ñn]anas?)\b/i;
const AFTERNOON = /\b(turno de tarde|horario de tarde|por las tardes|jornada de tarde|parcial\s*-\s*tarde|afternoon shift|evening shift)\b/i;

function detectSchedule(text: string, workday: string | null) {
  const combined = `${workday ?? ""}\n${text}`;
  let start: string | null = null;
  let end: string | null = null;
  let literal: string | null = null;
  const m = firstMatch(text, RANGE_PATTERNS);
  if (m) {
    literal = m[0].trim();
    if (m[4] && /am|pm/i.test(m[2] ?? "")) {
      const to24 = (h: string, ampm: string) => (Number(h) % 12) + (/pm/i.test(ampm) ? 12 : 0);
      start = clock(String(to24(m[1]!, m[2]!)));
      end = clock(String(to24(m[3]!, m[4]!)));
    } else if (m[4] !== undefined) {
      start = clock(m[1]!, m[2]);
      end = clock(m[3]!, m[4]);
    } else {
      start = clock(m[1]!);
      end = clock(m[2]!);
    }
    // Un rango de horas sin "horario" cerca podría ser otra cosa: solo se acepta si es una franja plausible.
    if (Number(start.slice(0, 2)) > 23 || Number(end.slice(0, 2)) > 24) {
      start = end = literal = null;
    }
  }
  const morning = MORNING.exec(combined);
  const afternoon = AFTERNOON.exec(combined);
  return {
    schedule: literal ?? morning?.[0] ?? afternoon?.[0] ?? workday ?? null,
    schedule_start: start,
    schedule_end: end,
    requires_morning_availability: (morning ? "yes" : afternoon ? "no" : "unknown") as Tri,
    afternoon_schedule_confirmed: Boolean(afternoon) && !morning,
  };
}

// ---------------------------------------------------------------- seniority

function detectSeniority(title: string, hints: SourceHints): CodeFacts["seniority"] {
  const t = title.toLowerCase();
  if (/\b(head of|director|manager|jefe|responsable de)\b/.test(t)) return "manager";
  if (/\b(lead|principal|staff|team lead)\b/.test(t)) return "lead";
  if (/\b(senior|sr\.?)\b/.test(t)) return "senior";
  if (/\b(junior|jr\.?|trainee|entry[- ]level|graduate)\b/.test(t)) return "junior";
  if (/\b(intern|internship|becari[oa]|pr[aá]cticas)\b/.test(t)) return "intern";
  const s = hints.seniority.map((x) => x.toLowerCase());
  if (s.length === 1) {
    if (s[0]!.includes("senior")) return "senior";
    if (s[0]!.includes("lead") || s[0]!.includes("manager") || s[0]!.includes("executive")) return "lead";
    if (s[0]!.includes("entry") || s[0]!.includes("junior")) return "junior";
    if (s[0]!.includes("mid")) return "mid";
  }
  return "unknown";
}

// ------------------------------------------------------------------ idiomas

const ENGLISH_ADVANCED = [
  /\b(?:fluent|fluency|native|bilingual|proficient|excellent|advanced|strong|business[- ]level)\s+(?:level\s+of\s+|command\s+of\s+)?english\b/i,
  /\benglish\s*(?:\(|:|-)?\s*(?:fluent|native|advanced|c1|c2|proficient)\b/i,
  /\bingl[eé]s\s*(?:\(|:|-)?\s*(?:alto|avanzado|fluido|nativo|biling[uü]e|c1|c2)\b/i,
  /\bnivel\s+(?:alto|avanzado|nativo)\s+de\s+ingl[eé]s\b/i,
  /\b(?:c1|c2)\b[^.\n]{0,25}\b(?:english|ingl[eé]s)\b/i,
  /\b(?:english|ingl[eé]s)\b[^.\n]{0,25}\b(?:c1|c2)\b/i,
];
const ENGLISH_B2 = [/\bb2\b[^.\n]{0,25}\b(?:english|ingl[eé]s)\b/i, /\b(?:english|ingl[eé]s)\b[^.\n]{0,25}\bb2\b/i, /\bupper[- ]intermediate\b/i, /\bingl[eé]s\s+medio[- ]alto\b/i];
const ENGLISH_B1 = [/\bb1\b[^.\n]{0,25}\b(?:english|ingl[eé]s)\b/i, /\b(?:english|ingl[eé]s)\b[^.\n]{0,25}\bb1\b/i, /\bintermediate\s+english\b/i, /\bingl[eé]s\s+(?:medio|intermedio)\b/i];

function detectEnglish(text: string): { level: CodeFacts["english_level_required"]; evidence?: string } {
  for (const [level, patterns] of [
    ["advanced", ENGLISH_ADVANCED],
    ["upper_intermediate", ENGLISH_B2],
    ["intermediate", ENGLISH_B1],
  ] as const) {
    const m = firstMatch(text, patterns);
    if (m && !OPTIONAL_CONTEXT.test(windowAround(text, m.index, 60))) return { level, evidence: m[0] };
  }
  return { level: "unknown" };
}

const OTHER_LANG = /\b(?:fluent|native|flie(?:ß|ss)end(?:e[sn]?)?|verhandlungssicher(?:e[sn]?)?|sehr gute[n]?|c1|c2)\s*(?:level\s+)?(german|deutsch(?:kenntnisse)?|french|dutch|italian|portuguese|polish|swedish|danish|norwegian|finnish)\b|\b(german|deutsch(?:kenntnisse)?|french|dutch|italian|portuguese|polish|swedish|danish|norwegian|finnish)\s*(?:\(|:|-)?\s*(?:fluent|native|c1|c2|flie(?:ß|ss)end|verhandlungssicher)\b/i;

function detectOtherLanguage(text: string): string | null {
  const m = OTHER_LANG.exec(text);
  if (!m || OPTIONAL_CONTEXT.test(windowAround(text, m.index, 60))) return null;
  return m[0].trim();
}

// -------------------------------------------------------------- experiencia

const EXPERIENCE_PATTERNS = [
  /\b(\d{1,2})\s*\+?\s*(?:a[ñn]os?|years?|jahre)\s+(?:de\s+|of\s+)?(?:experiencia|experience|berufserfahrung)/i,
  /\bexperiencia\s+(?:m[ií]nima\s+)?(?:de\s+)?(\d{1,2})\s*a[ñn]os?\b/i,
  /\bal menos\s+(\d{1,2})\s*a[ñn]os?\b/i,
  /\b(?:minimum|at least)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*years?\b/i,
];

function detectExperience(text: string): { years: number | null; literal: string | null } {
  if (/experiencia m[ií]nima:\s*no requerida/i.test(text)) return { years: 0, literal: "No requerida" };
  const m = firstMatch(text, EXPERIENCE_PATTERNS);
  if (!m) return { years: null, literal: null };
  const years = Number(m[1]);
  return Number.isFinite(years) && years <= 30 ? { years, literal: m[0].trim() } : { years: null, literal: null };
}

// ------------------------------------------------------ formación y tecnologías

const TRAINING_PATTERNS = [
  /plan de formaci[oó]n/i,
  /formaci[oó]n (?:interna|continua|a cargo|pagada|inicial|a medida)/i,
  /\bmentor(?:[ií]a|ing|ship)?\b/i,
  /\btutor(?:[ií]a|izad[oa])?\b/i,
  /acompañamiento/i,
  /\btraining (?:program|budget|plan|provided)\b/i,
  /\blearning (?:budget|and development|& development|opportunities)\b/i,
  /\bcertificaci(?:ones|ón) (?:pagadas|a cargo)|paid certifications?\b/i,
  /\bcareer (?:growth|development|path)\b/i,
  /desarrollo profesional|plan de carrera/i,
  /\bwe(?:'ll| will) teach you\b|\bno experience (?:required|needed)\b/i,
];

const TECH_KEYWORDS: [string, RegExp][] = [
  ["Windows", /\bwindows\b/i],
  ["Linux", /\blinux\b|\bubuntu\b|\bdebian\b|\bred ?hat\b|\bcentos\b/i],
  ["macOS", /\bmac ?os\b|\bapple\b/i],
  ["Active Directory", /\bactive directory\b|\bentra id\b|\bazure ad\b/i],
  ["Microsoft 365", /\b(?:microsoft|office) ?365\b|\bm365\b|\bo365\b|\bexchange\b|\bteams\b/i],
  ["Intune", /\bintune\b/i],
  ["Redes", /\bnetwork(?:ing)?\b|\bredes\b|\btcp\/ip\b|\blan\b|\bvpn\b|\bfirewall\b|\bswitch(?:es)?\b|\brouter/i],
  ["DNS/DHCP", /\bdns\b|\bdhcp\b/i],
  ["Virtualización", /\bvmware\b|\bhyper-?v\b|\bvirtuali[sz]a/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Cloud (Azure/AWS/GCP)", /\bazure\b|\baws\b|\bgcp\b|\bgoogle cloud\b/i],
  ["PowerShell", /\bpowershell\b/i],
  ["Bash", /\bbash\b|\bshell scripting\b/i],
  ["Python", /\bpython\b/i],
  ["SQL", /\bsql\b/i],
  ["ITIL", /\bitil\b/i],
  ["Ticketing (Jira/ServiceNow/Zendesk)", /\bjira\b|\bservicenow\b|\bzendesk\b|\bfreshdesk\b|\bglpi\b|\bticket/i],
  ["Hardware", /\bhardware\b|\bperif[eé]ricos\b|\bimpresoras?\b|\bprinters?\b/i],
  ["Ciberseguridad", /\bciberseguridad\b|\bcyber ?security\b|\bsecurity\b/i],
];

// ------------------------------------------------------------------ todo

export function extractFacts(c: V2Candidate): CodeFacts {
  const text = `${c.title}\n${c.details}`;
  const evidence: Record<string, string> = {};

  const remote = detectRemote(text, c.hints);
  if (remote.evidence) evidence.remote = remote.evidence;

  let allowsSpain: Tri = "unknown";
  if (c.hints.spain_allowed_by_query) allowsSpain = "yes";
  else allowsSpain = classifyLocationRestriction(c.hints.location_restriction);
  if (allowsSpain === "unknown" && /\b(remote|remoto)\s*(?:-|–|,|\(|en|from|desde)?\s*(spain|españa)\b/i.test(text)) allowsSpain = "yes";
  if (c.hints.location_restriction) evidence.location = c.hints.location_restriction;

  const hours = detectHours(text);
  if (hours.evidence) evidence.hours = hours.evidence;
  const schedule = detectSchedule(text, c.hints.workday_text);
  if (schedule.schedule) evidence.schedule = schedule.schedule;
  const english = detectEnglish(text);
  if (english.evidence) evidence.english = english.evidence;
  const exp = detectExperience(text);

  const training = TRAINING_PATTERNS.map((re) => re.exec(text)?.[0]).filter((x): x is string => Boolean(x));
  const technologies = TECH_KEYWORDS.filter(([, re]) => re.test(text)).map(([name]) => name);

  return {
    remote_type: remote.remote_type,
    remote_allows_spain: allowsSpain,
    remote_scope: c.hints.location_restriction,
    employment_type: detectEmployment(text, c.hints),
    hours_per_week: hours.hours,
    ...schedule,
    seniority: detectSeniority(c.title, c.hints),
    english_level_required: english.level,
    other_language_required: detectOtherLanguage(text),
    experience_years_min: exp.years,
    experience_required: exp.literal,
    salary_min: c.hints.salary_min,
    salary_max: c.hints.salary_max,
    salary_currency: c.hints.salary_currency,
    salary_period: c.hints.salary_period,
    training_signals: [...new Set(training)],
    technologies,
    evidence,
  };
}

