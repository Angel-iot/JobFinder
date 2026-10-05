-- =====================================================================
-- JobFinder v2: origen de la puntuación.
-- Migración ADITIVA: la v1 sigue funcionando igual (sus filas son 'claude').
--   score_source = 'claude' → puntuada por Claude
--   score_source = 'code'   → puntuada solo por reglas de código (Claude no
--                             disponible o fuera del máximo diario); se
--                             re-analiza con Claude cuando vuelve a aparecer.
-- =====================================================================
alter table public.jobs
  add column if not exists score_source text not null default 'claude'
    check (score_source in ('claude', 'code')),
  add column if not exists code_score smallint
    check (code_score is null or code_score between 0 and 100);

create index if not exists jobs_user_score_source_idx on public.jobs (user_id, score_source);

-- Las columnas nuevas solo las escribe el worker (service_role). Los
-- privilegios por columna existentes no cambian: el usuario autenticado
-- puede leerlas (select de tabla) pero solo actualizar status/is_updated.
