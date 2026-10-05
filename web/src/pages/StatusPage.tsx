import { JobList } from "../components/JobList";
import { fetchJobsByStatus } from "../lib/api";
import type { Job } from "../lib/types";
import { useAsync } from "../lib/useAsync";

interface Props {
  status: "saved" | "dismissed";
}

const COPY = {
  saved: {
    title: "⭐ Guardadas",
    intro: "Ofertas que has guardado. Si una cambia de forma significativa, se marca como «Actualizada».",
    empty: "Aún no has guardado ninguna oferta.",
  },
  dismissed: {
    title: "❌ Descartadas",
    intro: "Las ofertas descartadas no vuelven a aparecer en las búsquedas. Puedes restaurarlas.",
    empty: "No has descartado ninguna oferta.",
  },
};

export function StatusPage({ status }: Props) {
  const { data, setData, error, loading } = useAsync<Job[]>(() => fetchJobsByStatus(status), [status]);
  const copy = COPY[status];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{copy.title}</h1>
          <p className="muted">{copy.intro}</p>
        </div>
      </header>
      {error && <p className="alert alert-error">Error al cargar: {error}</p>}
      {loading && !data ? (
        <p className="muted">Cargando…</p>
      ) : (
        <JobList
          jobs={data ?? []}
          setJobs={(fn) => setData((d) => fn(d ?? []))}
          // Al quitar de guardadas o restaurar, la oferta sale de esta lista.
          removeOn={status === "saved" ? ["new", "dismissed"] : ["new"]}
          empty={copy.empty}
        />
      )}
    </div>
  );
}
