import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Login } from "./components/Login";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { HomePage } from "./pages/HomePage";
import { StatusPage } from "./pages/StatusPage";
import { TodayPage } from "./pages/TodayPage";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <div className="login-wrap">
        <div className="card login">
          <h1>Falta configuración</h1>
          <p>Define <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> (ver README).</p>
        </div>
      </div>
    );
  }
  if (!ready) return <p className="muted center">Cargando…</p>;
  if (!session) return <Login />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout email={session.user.email} />}>
          <Route index element={<HomePage />} />
          <Route path="hoy" element={<TodayPage />} />
          <Route path="guardadas" element={<StatusPage key="saved" status="saved" />} />
          <Route path="descartadas" element={<StatusPage key="dismissed" status="dismissed" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
