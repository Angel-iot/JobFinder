import { useMemo, useState } from "react";
import { acknowledgeUpdate, setJobStatus } from "../lib/api";
import { applyFilters, defaultFilters, groupByPriority, PRIORITY_GROUPS, type JobFilters } from "../lib/filters";
import type { Job, JobStatus } from "../lib/types";
import { FiltersBar } from "./FiltersBar";
import { JobCard } from "./JobCard";

interface Props {
  jobs: Job[];
  setJobs: (updater: (jobs: Job[]) => Job[]) => void;
  /** Al cambiar a uno de estos estados, la tarjeta desaparece de la lista. */
  removeOn: JobStatus[];
  grouped?: boolean;
  showStatusFilter?: boolean;
  empty: string;
}

export function JobList({ jobs, setJobs, removeOn, grouped, showStatusFilter, empty }: Props) {
  const [filters, setFilters] = useState<JobFilters>(defaultFilters);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source))].sort(), [jobs]);
  const visible = useMemo(() => applyFilters(jobs, filters), [jobs, filters]);

  async function changeStatus(job: Job, status: JobStatus) {
    setBusy(job.id);
    setError(null);
    const previous = jobs;
    // Actualización optimista.
    setJobs((list) =>
      removeOn.includes(status) ? list.filter((j) => j.id !== job.id) : list.map((j) => (j.id === job.id ? { ...j, status } : j)),
    );
    try {
      await setJobStatus(job.id, status);
    } catch (e) {
      setJobs(() => previous);
      setError(`No se pudo actualizar: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function acknowledge(job: Job) {
    setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, is_updated: false } : j)));
    try {
      await acknowledgeUpdate(job.id);
    } catch (e) {
      setError(`No se pudo actualizar: ${(e as Error).message}`);
    }
  }

  const renderCards = (list: Job[]) => (
    <div className="cards">
      {list.map((job) => (
        <JobCard key={job.id} job={job} onStatus={changeStatus} onAcknowledge={acknowledge} busy={busy === job.id} />
      ))}
    </div>
  );

  return (
    <>
      <FiltersBar value={filters} onChange={setFilters} sources={sources} showStatus={showStatusFilter} />
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {jobs.length > 0 && visible.length !== jobs.length && (
        <p className="muted small">Mostrando {visible.length} de {jobs.length} ofertas con los filtros actuales.</p>
      )}
      {visible.length === 0 ? (
        <p className="empty card">{jobs.length === 0 ? empty : "Ninguna oferta coincide con los filtros."}</p>
      ) : grouped ? (
        PRIORITY_GROUPS.map(({ key, label, icon }) => {
          const list = groupByPriority(visible)[key];
          if (!list.length) return null;
          return (
            <section key={key} className="group">
              <h2 className="group-title">
                <span aria-hidden>{icon}</span> {label} <span className="count">{list.length}</span>
              </h2>
              {renderCards(list)}
            </section>
          );
        })
      ) : (
        renderCards(visible)
      )}
    </>
  );
}
