import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

/** Inicio de sesión con Supabase Auth (el registro público está desactivado). */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("No se pudo iniciar sesión: revisa el email y la contraseña.");
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="brand">
          <img src="./favicon.svg" alt="" width={32} height={32} />
          <span>JobFinder</span>
        </div>
        <p className="muted">Tu buscador diario de ofertas. Inicia sesión para ver tus ofertas.</p>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
