import { Link } from "react-router-dom";
import { countByStatus, fetchJobsByStatus, fetchRecentActions, fetchRecentRuns } from "../lib/api";
import { longDate, madridToday, shortDateTime } from "../lib/format";
import type { Job, JobAction, JobStatus, SearchRun } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { Stat } from "./TodayPage";

interface HomeData {
  runs: SearchRun[];
  counts: Record<JobStatus, number>;
  top: Job[];
  actions: JobAction[];
}

const RUN_STATUS: Record<SearchRun["status"], string> = {
  running: "⏳ En curso",
  success: "✅ Completada",
  partial: "⚠️ Con avisos",
  failed: "⛔ Fallida",
};

const ACTION_LABEL: Record<JobAction["action"], string> = {
  saved: "⭐ Guardada",
  dismissed: "❌ Descartada",
  undismissed: "↩ Restaurada",
  unsaved: "Quitada de guardadas",
};

export function HomePage() {
  const { data, error, loading } = useAsync<HomeData>(async () => {
    const [runs, counts, top, actions] = await Promise.all([
      fetchRecentRuns(7),
      countByStatus(),
      fetchJobsByStatus("new"),
      fetchRecentActions(10),
    ]);
    return { runs, counts, top: top.slice(0, 5), actions };
  });

  const lastRun = data?.runs[0];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inicio</h1>
          <p className="date">{longDate(madridToday())}</p>
        </div>
      </header>

      {error && <p className="alert alert-error">Error al cargar: {error}</p>}
      {loading && !data && <p className="muted">Cargando…</p>}

      {data && (
        <>
          <div className="stats">
            <Stat label="Nuevas sin revisar" value={data.counts.new} />
            <Stat label="Guardadas" value={data.counts.saved} />
            <Stat label="Descartadas" value={data.counts.dismissed} />
          </div>

          <section className="card panel">
            <h2>Última búsqueda</h2>
            {lastRun ? (
              <p>
                {longDate(lastRun.run_date)} · {RUN_STATUS[lastRun.status]} ·{" "}
                {lastRun.stats.unique_candidates ?? "—"} encontradas, {lastRun.stats.relevant_today ?? "—"} relevantes.{" "}
                <Link to="/hoy">Ver ofertas →</Link>
              </p>
            ) : (
              <p className="muted">Aún no se ha ejecutado ninguna búsqueda. Se ejecuta automáticamente cada día hacia las 11:00.</p>
            )}
          </section>

          <section className="card panel">
            <h2>Mejores ofertas pendientes</h2>
            {data.top.length ? (
              <ol className="top-list">
                {data.top.map((j) => (
                  <li key={j.id}>
                    <span className="pill">⭐ {j.score}</span>
                    <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
                    <span className="muted"> · {j.company ?? "Empresa no especificada"}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No hay ofertas pendientes de revisar.</p>
            )}
          </section>

          <div className="two-col">
            <section className="card panel">
              <h2>Historial de búsquedas</h2>
              {data.runs.length ? (
                <table className="table">
                  <thead>
                    <tr><th>Día</th><th>Estado</th><th>Encontradas</th><th>Nuevas</th></tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.run_date}</td>
                        <td>{RUN_STATUS[r.status]}</td>
                        <td>{r.stats.unique_candidates ?? "—"}</td>
                        <td>{r.stats.inserted ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Sin ejecuciones todavía.</p>
              )}
            </section>

            <section className="card panel">
              <h2>Actividad reciente</h2>
              {data.actions.length ? (
                <ul className="activity">
                  {data.actions.map((a) => (
                    <li key={a.id}>
                      <span>{ACTION_LABEL[a.action]}</span> {a.jobs?.title ?? "Oferta"}
                      <span className="muted small"> · {shortDateTime(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Aún no has guardado ni descartado ofertas.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
