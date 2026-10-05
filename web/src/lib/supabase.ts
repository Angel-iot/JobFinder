import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Clave PÚBLICA (publishable / anon). La seguridad la garantiza Row Level Security.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || "https://invalid.local", anonKey || "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});
