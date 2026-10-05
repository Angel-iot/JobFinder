import { JobList } from "../components/JobList";
import { fetchJobsSeenOn, fetchLatestRun } from "../lib/api";
import { longDate, madridToday } from "../lib/format";
import type { Job, SearchRun } from "../lib/types";
import { useAsync } from "../lib/useAsync";

interface TodayData {
  run: SearchRun | null;
  jobs: Job[];
}

export function TodayPage() {
  const today = madridToday();
  const { data, setData, error, loading, reload } = useAsync<TodayData>(async () => {
    const run = await fetchLatestRun();
    const jobs = run ? await fetchJobsSeenOn(run.run_date) : [];
    return { run, jobs };
  });

  const run = data?.run ?? null;
  const jobs = data?.jobs ?? [];
  const isToday = run?.run_date === today;
  const found = run?.stats.unique_candidates ?? run?.stats.candidates_found;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Ofertas de hoy</h1>
          <p className="date">{longDate(today)}</p>
        </div>
        <button className="btn btn-ghost" onClick={reload} disabled={loading}>Actualizar</button>
      </header>

      {run && !isToday && (
        <p className="alert alert-info">
          La búsqueda de hoy aún no se ha ejecutado (se ejecuta cada día hacia las 11:00). Mostrando la del {longDate(run.run_date)}.
        </p>
      )}
      {run?.status === "running" && <p className="alert alert-info">La búsqueda está en curso. Vuelve a cargar en unos minutos.</p>}
      {run?.status === "failed" && <p className="alert alert-error">La última búsqueda falló. Revisa los logs de GitHub Actions.</p>}

      {run && (
        <div className="stats">
          <Stat label="Encontradas" value={found ?? "—"} />
          <Stat label="Relevantes" value={jobs.length} />
          <Stat label="Prioridad alta" value={jobs.filter((j) => j.priority === "high").length} />
        </div>
      )}

      {error && <p className="alert alert-error">Error al cargar: {error}</p>}
      {loading && !data ? (
        <p className="muted">Cargando…</p>
      ) : !run ? (
        <p className="empty card">Todavía no se ha ejecutado ninguna búsqueda.</p>
      ) : (
        <JobList
          jobs={jobs}
          setJobs={(fn) => setData((d) => (d ? { ...d, jobs: fn(d.jobs) } : d))}
          removeOn={["dismissed"]}
          grouped
          showStatusFilter
          empty="No hay ofertas relevantes en esta búsqueda."
        />
      )}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
