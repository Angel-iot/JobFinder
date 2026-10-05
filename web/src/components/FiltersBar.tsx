import { useState } from "react";
import { defaultFilters, type JobFilters } from "../lib/filters";
import { sourceLabel } from "../lib/format";

interface Props {
  value: JobFilters;
  onChange: (f: JobFilters) => void;
  sources: string[];
  showStatus?: boolean;
}

export function FiltersBar({ value, onChange, sources, showStatus }: Props) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof JobFilters>(key: K, v: JobFilters[K]) => onChange({ ...value, [key]: v });
  const active = JSON.stringify(value) !== JSON.stringify(defaultFilters);

  return (
    <section className="card filters">
      <div className="filters-head">
        <input
          type="search"
          placeholder="Buscar puesto o empresa…"
          value={value.role}
          onChange={(e) => set("role", e.target.value)}
          aria-label="Puesto"
        />
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Filtros{active ? " •" : ""}
        </button>
      </div>
      {open && (
        <div className="filters-grid">
          <label>
            Puntuación mínima: <strong>{value.minScore}</strong>
            <input type="range" min={0} max={100} step={5} value={value.minScore} onChange={(e) => set("minScore", Number(e.target.value))} />
          </label>
          <label>
            Horas
            <select value={value.hours} onChange={(e) => set("hours", e.target.value as JobFilters["hours"])}>
              <option value="any">Todas</option>
              <option value="le20">≤ 20 h</option>
              <option value="le25">≤ 25 h</option>
              <option value="unknown">No especificadas</option>
            </select>
          </label>
          <label>
            Fuente
            <select value={value.source} onChange={(e) => set("source", e.target.value)}>
              <option value="any">Todas</option>
              {sources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
            </select>
          </label>
          <label>
            Modalidad
            <select value={value.remote} onChange={(e) => set("remote", e.target.value as JobFilters["remote"])}>
              <option value="any">Todas</option>
              <option value="confirmed">100% remoto confirmado</option>
              <option value="unconfirmed">Remoto no confirmado / ambiguo</option>
            </select>
          </label>
          <label>
            Salario
            <select value={value.salary} onChange={(e) => set("salary", e.target.value as JobFilters["salary"])}>
              <option value="any">Todos</option>
              <option value="published">Solo con salario publicado</option>
            </select>
          </label>
          {showStatus && (
            <label>
              Estado
              <select value={value.status} onChange={(e) => set("status", e.target.value as JobFilters["status"])}>
                <option value="any">Nuevas y guardadas</option>
                <option value="new">Nuevas</option>
                <option value="saved">Guardadas</option>
              </select>
            </label>
          )}
          <button className="btn btn-ghost" onClick={() => onChange(defaultFilters)}>Limpiar filtros</button>
        </div>
      )}
    </section>
  );
}
