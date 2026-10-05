import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", icon: "🏠", label: "Inicio", end: true },
  { to: "/hoy", icon: "🔥", label: "Ofertas de hoy" },
  { to: "/guardadas", icon: "⭐", label: "Guardadas" },
  { to: "/descartadas", icon: "❌", label: "Descartadas" },
];

export function Layout({ email }: { email: string | undefined }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <span>JobFinder</span>
        </div>
        <nav aria-label="Secciones">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              <span className="nav-icon" aria-hidden>{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted small" title={email}>{email}</span>
          <button className="btn btn-ghost small" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
        <footer className="attribution">
          Fuentes de las ofertas: <a href="https://developer.infojobs.net" target="_blank" rel="noopener noreferrer">InfoJobs API</a>,{" "}
          <a href="https://www.adzuna.co.uk" target="_blank" rel="noopener noreferrer">The Adzuna API</a>,{" "}
          <a href="https://himalayas.app" target="_blank" rel="noopener noreferrer">Himalayas</a>,{" "}
          <a href="https://remotive.com" target="_blank" rel="noopener noreferrer">Remotive</a>,{" "}
          <a href="https://remoteok.com" target="_blank" rel="noopener noreferrer">Remote OK</a>,{" "}
          <a href="https://www.arbeitnow.com" target="_blank" rel="noopener noreferrer">Arbeitnow</a>. Cada oferta enlaza a su página original.
        </footer>
      </main>
    </div>
  );
}
