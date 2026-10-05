/**
 * PERFIL REAL DEL USUARIO.
 *
 * Este archivo es la única fuente de verdad sobre el candidato. Claude recibe
 * este perfil tal cual; no debe deducir ni añadir nada que no esté aquí.
 * Para actualizar el perfil, edita este archivo y haz commit (ver README).
 */

export type SkillLevel = "sí" | "básico" | "no";

export interface CandidateProfile {
  location: { city: string; country: string; countryCode: string };
  education: { completed: string[]; inProgress: string[] };
  experience: { description: string; months: number }[];
  languages: { language: string; level: string }[];
  skills: Record<string, SkillLevel>;
}

export const profile: CandidateProfile = {
  location: { city: "Valencia", country: "España", countryCode: "ES" },
  education: {
    completed: ["SMR (Sistemas Microinformáticos y Redes) - terminado"],
    inProgress: ["ASIR (Administración de Sistemas Informáticos en Red) - cursando 1º"],
  },
  experience: [{ description: "Prácticas de IT / helpdesk en Vithas", months: 4 }],
  languages: [
    { language: "Español", level: "nativo" },
    { language: "Valenciano", level: "alto" },
    // No asumir un nivel superior al indicado.
    { language: "Inglés", level: "básico" },
  ],
  skills: {
    Windows: "sí",
    Linux: "sí",
    "Redes TCP/IP": "sí",
    DNS: "sí",
    DHCP: "sí",
    SSH: "sí",
    RDP: "básico",
    "Hardware / montaje de PCs": "sí",
    "Resolución de problemas de hardware": "sí",
    "Resolución de problemas de software": "sí",
    "Active Directory": "básico",
    "Usuarios/permisos de Windows": "sí",
    "Virtualización (VirtualBox/VMware/Hyper-V)": "sí",
    Docker: "básico",
    NAS: "básico",
    TrueNAS: "básico",
    Syncthing: "básico",
    Bash: "sí",
    PowerShell: "básico",
    Python: "no",
    SQL: "no",
    "Git/GitHub": "básico",
    "Routers / configuración de redes": "sí",
    "Wi-Fi": "sí",
    Ciberseguridad: "básico",
    Cloud: "básico",
    "Microsoft 365": "sí",
  },
};

/** Texto del perfil para el prompt de Claude (determinista, para prompt caching). */
export function renderProfileForPrompt(p: CandidateProfile = profile): string {
  const skills = Object.entries(p.skills)
    .map(([name, level]) => `- ${name}: ${level}`)
    .join("\n");
  return [
    `Ubicación: ${p.location.city}, ${p.location.country}.`,
    `Formación terminada: ${p.education.completed.join("; ")}.`,
    `Formación en curso: ${p.education.inProgress.join("; ")}.`,
    `Experiencia: ${p.experience.map((e) => `${e.description} (${e.months} meses)`).join("; ")}.`,
    `Idiomas: ${p.languages.map((l) => `${l.language} ${l.level}`).join(", ")}.`,
    "Conocimientos técnicos (sí = lo domina a nivel junior, básico = nociones, no = no lo conoce):",
    skills,
  ].join("\n");
}
