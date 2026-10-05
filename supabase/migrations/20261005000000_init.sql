-- =====================================================================
-- JobFinder - schema inicial
--
-- Modelo de seguridad:
--   * El worker (GitHub Actions) usa la clave secreta (service_role /
--     sb_secret_...) que omite RLS: es el ÚNICO que inserta ofertas.
--   * El frontend usa la clave pública (anon / sb_publishable_...) + sesión
--     de Supabase Auth. Con RLS solo puede LEER sus filas y CAMBIAR el
--     estado (status / is_updated) de sus ofertas. No puede insertar,
--     borrar ni modificar el contenido de las ofertas.
--   * El historial (job_actions) lo escribe un trigger, no el cliente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------
create table public.jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  -- Identidad / deduplicación
  source            text not null,                 -- linkedin | infojobs | otra fuente (dominio)
  external_id       text,                          -- ID de la plataforma si existe
  url               text not null,
  canonical_url     text not null,
  alternate_urls    text[] not null default '{}',  -- misma oferta vista en otras fuentes
  fingerprint       text not null,                 -- hash(empresa + título normalizados)
  content_hash      text not null,                 -- hash del contenido relevante

  -- Datos de la oferta (null = no especificado; nunca inventado)
  title             text not null,
  company           text,
  location          text,
  remote_type       text not null default 'unknown'
                    check (remote_type in ('full_remote', 'hybrid', 'onsite', 'unknown')),
  remote_scope      text,                          -- p. ej. "España", "Europa (incluye España)"
  remote_location_ambiguous boolean not null default false,
  employment_type   text not null default 'unknown'
                    check (employment_type in ('part_time', 'full_time', 'internship', 'freelance', 'unknown')),
  hours_per_week    numeric(5, 1),
  schedule          text,                          -- texto literal del horario, o null
  schedule_start    text,                          -- HH:MM si se conoce
  schedule_end      text,
  salary_min        numeric(12, 2),
  salary_max        numeric(12, 2),
  salary_currency   text,
  salary_period     text check (salary_period in ('hour', 'month', 'year')),
  salary_text       text,
  experience_required text,
  experience_years_min numeric(4, 1),
  education_required text,
  english_level     text not null default 'unknown',
  seniority         text not null default 'unknown',
  description       text,
  summary           text,
  requirements      text[] not null default '{}',
  technologies      text[] not null default '{}',
  training_info     text,
  growth_info       text,
  match_reasons     text[] not null default '{}',  -- "Por qué encaja"
  red_flags         text[] not null default '{}',  -- "Posibles problemas"
  score             smallint not null check (score between 0 and 100),
  score_reasons     text[] not null default '{}',
  score_breakdown   jsonb not null default '{}'::jsonb,
  priority          text not null default 'other'
                    check (priority in ('high', 'interesting', 'other')),

  -- Fechas
  published_at      timestamptz,
  found_at          timestamptz not null default now(),   -- primera vez encontrada
  last_seen_at      timestamptz not null default now(),
  first_seen_date   date not null,                        -- fecha local Europe/Madrid
  last_seen_date    date not null,
  last_run_id       uuid,

  -- Estado del usuario
  status            text not null default 'new'
                    check (status in ('new', 'saved', 'dismissed')),
  status_changed_at timestamptz,
  is_updated        boolean not null default false,       -- oferta guardada que ha cambiado

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index jobs_user_canonical_url_key on public.jobs (user_id, canonical_url);
create unique index jobs_user_source_external_key on public.jobs (user_id, source, external_id)
  where external_id is not null;
create index jobs_user_fingerprint_idx on public.jobs (user_id, fingerprint);
create index jobs_user_last_seen_idx on public.jobs (user_id, last_seen_date desc);
create index jobs_user_status_idx on public.jobs (user_id, status);
create index jobs_user_score_idx on public.jobs (user_id, score desc);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- job_actions (historial de acciones del usuario)
-- ---------------------------------------------------------------------
create table public.job_actions (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  action      text not null check (action in ('saved', 'dismissed', 'undismissed', 'unsaved')),
  created_at  timestamptz not null default now()
);

create index job_actions_user_created_idx on public.job_actions (user_id, created_at desc);
create index job_actions_job_idx on public.job_actions (job_id);

-- El historial se registra automáticamente al cambiar el estado.
create or replace function public.log_job_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_action := case
    when new.status = 'saved' then 'saved'
    when new.status = 'dismissed' then 'dismissed'
    when old.status = 'dismissed' then 'undismissed'
    when old.status = 'saved' then 'unsaved'
  end;

  if v_action is not null then
    insert into public.job_actions (job_id, user_id, action)
    values (new.id, new.user_id, v_action);
  end if;
  return new;
end;
$$;

create or replace function public.stamp_job_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status <> 'saved' then
      new.is_updated := false;
    end if;
  end if;
  return new;
end;
$$;

create trigger jobs_stamp_status_change
  before update of status on public.jobs
  for each row execute function public.stamp_job_status_change();

create trigger jobs_log_status_change
  after update of status on public.jobs
  for each row execute function public.log_job_status_change();

-- ---------------------------------------------------------------------
-- search_runs (una ejecución diaria; protege contra ejecuciones dobles)
-- ---------------------------------------------------------------------
create table public.search_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  run_date     date not null,                    -- fecha local Europe/Madrid
  status       text not null default 'running'
               check (status in ('running', 'success', 'partial', 'failed')),
  trigger      text not null default 'schedule', -- schedule | manual | local
  attempts     smallint not null default 1,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}'::jsonb,
  errors       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, run_date)
);

create trigger search_runs_set_updated_at
  before update on public.search_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- job_rejections (ofertas descartadas automáticamente por filtros duros)
-- Evita re-analizarlas cada día y permite auditar por qué se descartaron.
-- ---------------------------------------------------------------------
create table public.job_rejections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  canonical_url  text not null,
  fingerprint    text not null,
  content_hash   text not null,
  source         text not null,
  url            text not null,
  title          text not null,
  company        text,
  reasons        text[] not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (user_id, canonical_url)
);

create index job_rejections_user_fingerprint_idx on public.job_rejections (user_id, fingerprint);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.jobs           enable row level security;
alter table public.job_actions    enable row level security;
alter table public.search_runs    enable row level security;
alter table public.job_rejections enable row level security;

-- Privilegios explícitos: anon no ve nada; authenticated solo lo mínimo.
revoke all on public.jobs, public.job_actions, public.search_runs, public.job_rejections from anon, authenticated;
grant select on public.jobs, public.job_actions, public.search_runs, public.job_rejections to authenticated;
-- El usuario solo puede cambiar el estado de la oferta (y marcar "actualizada" como vista).
grant update (status, is_updated) on public.jobs to authenticated;

grant all on public.jobs, public.job_actions, public.search_runs, public.job_rejections to service_role;

create policy "jobs: leer las propias"
  on public.jobs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "jobs: cambiar estado de las propias"
  on public.jobs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "job_actions: leer las propias"
  on public.job_actions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "search_runs: leer las propias"
  on public.search_runs for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "job_rejections: leer las propias"
  on public.job_rejections for select to authenticated
  using ((select auth.uid()) = user_id);

-- Las funciones de trigger no deben poder invocarse vía API.
revoke execute on function public.log_job_status_change() from public, anon, authenticated;
revoke execute on function public.stamp_job_status_change() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
