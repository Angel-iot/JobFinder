import type { Job, JobStatus, Priority } from "./types";

export interface JobFilters {
  minScore: number;
  hours: "any" | "le20" | "le25" | "unknown";
  source: string; // "any" o nombre de fuente
  remote: "any" | "confirmed" | "unconfirmed";
  salary: "any" | "published";
  role: string; // texto libre sobre título / empresa
  status: "any" | JobStatus;
}

export const defaultFilters: JobFilters = {
  minScore: 0,
  hours: "any",
  source: "any",
  remote: "any",
  salary: "any",
  role: "",
  status: "any",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function applyFilters(jobs: Job[], f: JobFilters): Job[] {
  const role = norm(f.role.trim());
  return jobs
    .filter((j) => j.score >= f.minScore)
    .filter((j) => {
      if (f.hours === "le20") return j.hours_per_week !== null && j.hours_per_week <= 20;
      if (f.hours === "le25") return j.hours_per_week !== null && j.hours_per_week <= 25;
      if (f.hours === "unknown") return j.hours_per_week === null;
      return true;
    })
    .filter((j) => f.source === "any" || j.source === f.source)
    .filter((j) => {
      const confirmed = j.remote_type === "full_remote" && !j.remote_location_ambiguous;
      if (f.remote === "confirmed") return confirmed;
      if (f.remote === "unconfirmed") return !confirmed;
      return true;
    })
    .filter((j) => f.salary === "any" || j.salary_min !== null || j.salary_max !== null)
    .filter((j) => !role || norm(`${j.title} ${j.company ?? ""}`).includes(role))
    .filter((j) => f.status === "any" || j.status === f.status)
    .sort((a, b) => b.score - a.score);
}

export const PRIORITY_GROUPS: { key: Priority; label: string; icon: string }[] = [
  { key: "high", label: "Prioridad alta", icon: "🟢" },
  { key: "interesting", label: "Interesantes", icon: "🟡" },
  { key: "other", label: "Otras", icon: "⚪" },
];

export function groupByPriority(jobs: Job[]): Record<Priority, Job[]> {
  const groups: Record<Priority, Job[]> = { high: [], interesting: [], other: [] };
  for (const j of jobs) groups[j.priority].push(j);
  return groups;
}
