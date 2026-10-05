import { useState } from "react";
import {
  experienceLabel,
  hoursLabel,
  locationLabel,
  remoteLabel,
  salaryLabel,
  scheduleLabel,
  sourceLabel,
} from "../lib/format";
import type { Job, JobStatus } from "../lib/types";

interface Props {
  job: Job;
  onStatus: (job: Job, status: JobStatus) => void;
  onAcknowledge?: (job: Job) => void;
  busy?: boolean;
}

export function JobCard({ job, onStatus, onAcknowledge, busy }: Props) {
  const [expanded, setExpanded] = useState(false);
  const scoreClass = job.score >= 75 ? "score-high" : job.score >= 55 ? "score-mid" : "score-low";

  return (
    <article className={`card job-card status-${job.status}`} aria-labelledby={`job-${job.id}`}>
      <header className="job-head">
        <div className={`score ${scoreClass}`} title="Puntuación de encaje (0–100)">
          <span aria-hidden>⭐</span> {job.score}
        </div>
        <div className="job-titles">
          <h3 id={`job-${job.id}`}>{job.title}</h3>
          <p className="company">{job.company ?? "Empresa no especificada"}</p>
        </div>
        <div className="badges">
          <span className="badge">{sourceLabel(job.source)}</span>
          {job.status === "saved" && <span className="badge badge-saved">Guardada</span>}
          {job.score_source === "code" && (
            <span className="badge badge-code" title="Claude no estaba disponible: puntuación calculada solo con reglas. Se re-analizará si la oferta vuelve a aparecer.">
              Nota automática (sin IA)
            </span>
          )}
          {job.is_updated && (
            <button className="badge badge-updated" onClick={() => onAcknowledge?.(job)} title="Marcar cambio como visto">
              Actualizada ✓
            </button>
          )}
        </div>
      </header>

      <dl className="facts">
        <Fact label="Modalidad" value={remoteLabel(job)} warn={job.remote_type !== "full_remote" || job.remote_location_ambiguous} />
        <Fact label="Jornada" value={hoursLabel(job)} warn={job.hours_per_week === null} />
        <Fact label="Horario" value={scheduleLabel(job)} warn={!job.schedule} />
        <Fact label="Salario" value={salaryLabel(job)} warn={job.salary_min === null && job.salary_max === null} />
        <Fact label="Experiencia" value={experienceLabel(job)} />
        <Fact label="Ubicación" value={locationLabel(job)} />
      </dl>

      <div className="reasons">
        <section>
          <h4>Por qué encaja</h4>
          {job.match_reasons.length ? (
            <ul className="list-good">{job.match_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          ) : (
            <p className="muted">—</p>
          )}
        </section>
        <section>
          <h4>Posibles problemas</h4>
          {job.red_flags.length ? (
            <ul className="list-bad">{job.red_flags.map((r) => <li key={r}>{r}</li>)}</ul>
          ) : (
            <p className="muted">Ninguno detectado</p>
          )}
        </section>
      </div>

      {expanded && (
        <div className="details">
          {job.summary && <p>{job.summary}</p>}
          {job.training_info && <p><strong>Formación:</strong> {job.training_info}</p>}
          {job.growth_info && <p><strong>Crecimiento:</strong> {job.growth_info}</p>}
          {job.technologies.length > 0 && <p><strong>Tecnologías:</strong> {job.technologies.join(", ")}</p>}
          {job.requirements.length > 0 && (
            <>
              <strong>Requisitos:</strong>
              <ul>{job.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          )}
          {job.education_required && <p><strong>Estudios:</strong> {job.education_required}</p>}
          {job.published_at && <p><strong>Publicada:</strong> {new Date(job.published_at).toLocaleDateString("es-ES")}</p>}
          <p className="muted">Encontrada: {new Date(job.found_at).toLocaleDateString("es-ES")}</p>
          {job.alternate_urls.length > 0 && (
            <p className="muted">
              También en:{" "}
              {job.alternate_urls.map((u, i) => (
                <span key={u}>
                  {i > 0 && ", "}
                  <a href={u} target="_blank" rel="noopener noreferrer">{new URL(u).hostname.replace(/^www\./, "")}</a>
                </span>
              ))}
            </p>
          )}
          {job.description && (
            <details>
              <summary>Información recopilada de la oferta</summary>
              <p className="pre">{job.description}</p>
            </details>
          )}
        </div>
      )}

      <footer className="actions">
        <a className="btn btn-primary" href={job.url} target="_blank" rel="noopener noreferrer">
          Abrir oferta
        </a>
        {job.status === "saved" ? (
          <button className="btn" disabled={busy} onClick={() => onStatus(job, "new")}>Quitar de guardadas</button>
        ) : job.status === "new" ? (
          <button className="btn btn-save" disabled={busy} onClick={() => onStatus(job, "saved")}>⭐ Guardar</button>
        ) : null}
        {job.status === "dismissed" ? (
          <button className="btn" disabled={busy} onClick={() => onStatus(job, "new")}>↩ Restaurar</button>
        ) : (
          <button className="btn btn-dismiss" disabled={busy} onClick={() => onStatus(job, "dismissed")}>❌ Descartar</button>
        )}
        <button className="btn btn-ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? "Menos" : "Más detalles"}
        </button>
      </footer>
    </article>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? "fact fact-warn" : "fact"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
