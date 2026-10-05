# JobFinder

Sistema personal que **busca → analiza → filtra → guarda → muestra** cada día ofertas de empleo IT que encajan con tu perfil.
**No aplica a ninguna oferta**: tú decides a cuáles aplicar.

> **Hay dos versiones.** La **v2** (recomendada) cuesta **0 €**: fuentes oficiales gratuitas + análisis con tu **suscripción de Claude** vía `claude-code-action`. La **v1** (legacy) usa la API de Anthropic con pago por uso; se conserva sin cron, solo manual. La sección [JobFinder v2](#jobfinder-v2-0-) explica la nueva; el resto del documento describe la v1 y las partes comunes (Supabase, frontend, perfil, preferencias).

---

## JobFinder v2 (0 €)

```
APIs oficiales/gratuitas ─▶ relevancia ─▶ dedup ─▶ filtros duros (código) ─▶ work/candidates/*.md
                                                                                   │
                       claude-code-action + CLAUDE_CODE_OAUTH_TOKEN (tu suscripción) ◀┘
                       (solo herramienta Read, sin shell ni web; salida --json-schema)
                                                                                   │
Supabase ◀─ filtros duros otra vez sobre los datos de Claude ◀─ JSON validado (zod) ◀┘
          (si Claude falla / se agota la cuota → se guarda con la nota calculada por código)
```

**Pasos del workflow** [`job-search-v2.yml`](.github/workflows/job-search-v2.yml) (de momento **solo manual**):

| Paso | Qué hace | Secrets que recibe |
|---|---|---|
| Comprobación | Se detiene si existe el secret `ANTHROPIC_API_KEY` o variables de API de Anthropic | ninguno (solo comprueba si existe) |
| 1 · collect | Consulta las fuentes, aplica relevancia y filtros duros, escribe `work/` | `SUPABASE_*`, `JOBFINDER_USER_ID`, opcionales `INFOJOBS_*`, `ADZUNA_*` |
| 2 · Claude | `anthropics/claude-code-action` (versión fijada por SHA) lee `work/` y devuelve JSON estructurado. `continue-on-error` | **solo** `CLAUDE_CODE_OAUTH_TOKEN` |
| 3 · store | Lee el resultado, valida, re-aplica filtros, guarda en Supabase, publica métricas | `SUPABASE_*`, `JOBFINDER_USER_ID` |

**Fuentes** (todas con acceso automatizado permitido; el panel cita la fuente y enlaza a la oferta original, como piden sus condiciones):

| Fuente | Clave | Notas |
|---|---|---|
| [Himalayas](https://himalayas.app/api) | no | Búsqueda con `country=ES` → solo ofertas que admiten España |
| [Remotive](https://remotive.com/api/remote-jobs) | no | 1 petición/ejecución (piden máx. ~4/día) |
| [Remote OK](https://remoteok.com/api) | no | 1 petición/ejecución |
| [Arbeitnow](https://www.arbeitnow.com/api/job-board-api) | no | Solo ofertas marcadas como remotas |
| [InfoJobs API](https://developer.infojobs.net) | sí (app, gratis) | `teleworking=solo-teletrabajo` |
| [Adzuna API](https://developer.adzuna.com) | sí (app, gratis) | Uso "personal research"; 250 llamadas/día |

LinkedIn y Google **no** se usan en la v2: no ofrecen un acceso automatizado permitido para esto.

**Garantías de 0 € (comprobadas por tests en `worker/test/v2/safety.test.ts`):**
- Ningún módulo de `src/v2` importa `@anthropic-ai/sdk`.
- El workflow v2 autentica a Claude solo con `claude_code_oauth_token` y se detiene si existe `ANTHROPIC_API_KEY`.
- El worker v2 se niega a arrancar si encuentra `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` en el entorno.
- Ningún workflow combina cron con la API de pago (la v1 ya no tiene cron).
- No actives "usage credits" en claude.ai si quieres que, al agotar la cuota, no haya ningún cargo: en ese caso Claude falla y la v2 guarda las ofertas con la nota por código.

**Qué hace Claude y qué hace el código:**
- Código: relevancia del puesto, filtros duros (antes y después de Claude), deduplicación, nota de respaldo.
- Claude: extracción fina de datos, encaje, formación/mentoría, tecnologías, problemas, resumen y **puntuación final**.
- Las ofertas puntuadas solo por código muestran "Nota automática (sin IA)" y se re-analizan con Claude si vuelven a aparecer.

**Métricas de cada ejecución** (resumen en la página del workflow, `work/metrics.json` en los artefactos y `search_runs.stats`): ofertas por fuente, descartes por relevancia y por cada filtro, enviadas a Claude, analizadas, guardadas, tiempo total y por paso, errores, y consumo de Claude (modelo, turnos, tokens, coste *equivalente* de API —no facturado con suscripción— y eventos de límite de uso si los hay). El % de cuota restante del plan no se expone; se ve en claude.ai/settings/usage.

**Probar en local sin Claude ni Supabase:**

```bash
cd worker
WORK_DIR=work npm run v2:collect -- --dry-run      # consulta las APIs públicas gratuitas
CLAUDE_SKIPPED_REASON=by_input WORK_DIR=work npm run v2:store -- --dry-run
```

**Configuración de la v2:** ver [Configurar la v2](#configurar-la-v2).

### Configurar la v2

1. **Supabase**: ejecuta también [`supabase/migrations/20261006000000_v2_score_source.sql`](supabase/migrations/20261006000000_v2_score_source.sql) en el SQL Editor (es aditiva: no afecta a la v1). Hazlo **antes** de desplegar el frontend nuevo, que lee la columna `score_source`.
2. **Token de suscripción**: en tu PC, con Claude Code instalado y tu cuenta Pro, ejecuta `claude setup-token`, aprueba en el navegador y copia el token que aparece en la terminal (dura 1 año; no se guarda en ningún archivo).
3. **GitHub → Settings → Secrets and variables → Actions → Secrets**:
   - `CLAUDE_CODE_OAUTH_TOKEN` = el token del paso 2.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JOBFINDER_USER_ID` (como en la v1).
   - Opcionales: `INFOJOBS_CLIENT_ID`, `INFOJOBS_CLIENT_SECRET`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`.
   - **No** crees `ANTHROPIC_API_KEY` (si existe, bórralo: la v2 se negará a ejecutarse).
4. Opcional, en **Variables**: `CLAUDE_MODEL` si quieres fijar un modelo concreto (por defecto, el de Claude Code para tu plan).
5. **Actions → "Búsqueda v2 (prueba manual)" → Run workflow**. Opciones: `skip_claude` (probar sin Claude), `max_claude` (máximo de ofertas a analizar), `force` (repetir hoy).

---

## Índice

1. [Arquitectura](#arquitectura)
2. [Decisiones técnicas](#decisiones-técnicas)
3. [Instalación](#instalación)
4. [Variables de entorno](#variables-de-entorno)
5. [Configuración de Supabase](#configuración-de-supabase)
6. [Configuración de Claude](#configuración-de-claude)
7. [Configuración de GitHub Actions](#configuración-de-github-actions)
8. [Desplegar el frontend](#desplegar-el-frontend-github-pages)
9. [Cambiar el perfil](#cambiar-el-perfil)
10. [Cambiar preferencias y puntuación](#cambiar-preferencias-y-puntuación)
11. [Ejecutar una búsqueda manual](#ejecutar-una-búsqueda-manual)
12. [Logs](#logs)
13. [Tests](#tests)
14. [Solución de problemas](#solución-de-problemas)

---

## Arquitectura

```
          GitHub Actions (v1 legacy: ahora solo manual; antes cron 11:00 Europe/Madrid)
                                     │
                         worker/  (Node 22 + TypeScript)
   ┌─────────────────────────────────┼──────────────────────────────────┐
   │ 1. BUSCA                        │                                  │
   │   Claude + web_search/web_fetch │  API oficial InfoJobs (opcional) │
   │   4 lotes de consultas          │                                  │
   │   (LinkedIn → InfoJobs → resto) │                                  │
   ├─────────────────────────────────┴──────────────────────────────────┤
   │ 2. DEDUPLICA  URL canónica · ID externo · empresa+título · hash     │
   │ 3. CRUZA con la BD: descartadas por ti → fuera; ya conocidas → hoy │
   │ 4. ANALIZA   Claude (structured outputs, JSON validado con zod)    │
   │ 5. FILTRA    reglas duras en código (remoto, horario, jornada...)  │
   │ 6. PUNTÚA    0–100 (reglas fijas + valoración subjetiva de Claude) │
   │ 7. GUARDA    Supabase (clave secreta, solo en el worker)           │
   └──────────────────────────────────┬─────────────────────────────────┘
                                      │
                         Supabase (Postgres + Auth + RLS)
                                      │  clave pública + sesión
                         web/  (React + Vite, GitHub Pages)
               🏠 Inicio · 🔥 Ofertas de hoy · ⭐ Guardadas · ❌ Descartadas
```

```
.
├── .github/workflows/
│   ├── daily-job-search.yml   # v1 LEGACY (API de pago): solo manual
│   ├── job-search-v2.yml      # v2 (0 €): suscripción vía claude-code-action, manual por ahora
│   ├── ci.yml                 # typecheck + tests + build
│   └── deploy-pages.yml       # despliegue del panel en GitHub Pages
├── supabase/migrations/       # schema SQL (tablas, triggers, RLS)
├── worker/
│   ├── src/
│   │   ├── config/            # profile.ts (TU PERFIL), preferences.ts, searchQueries.ts, env.ts
│   │   ├── claude/            # cliente, prompts, esquemas, búsqueda (discover), análisis (evaluate)
│   │   ├── scoring/           # hardFilters.ts (reglas duras) + score.ts (puntuación)
│   │   ├── dedup/             # URL canónica, huellas, deduplicación
│   │   ├── sources/           # API oficial de InfoJobs (opcional)
│   │   ├── storage/           # Supabase + repositorio en memoria (pruebas)
│   │   ├── pipeline.ts        # orquestación
│   │   └── index.ts           # CLI
│   └── test/                  # tests (incluye schema + RLS sobre Postgres embebido)
└── web/                       # panel React + Vite
```

### Tablas

| Tabla | Para qué |
|---|---|
| `jobs` | Ofertas relevantes (todos los campos pedidos + puntuación, motivos, estado `new`/`saved`/`dismissed`). |
| `job_actions` | Historial: `saved`, `dismissed`, `undismissed` (y `unsaved` al quitar de guardadas). Lo escribe un trigger, no el navegador. |
| `search_runs` | Una fila por día (fecha de Madrid): estado, estadísticas y errores. Evita ejecutar dos veces el mismo día. |
| `job_rejections` | Ofertas descartadas automáticamente y por qué. Evita volver a analizarlas (y pagar por ello) cada día. |

### Reglas de ofertas repetidas

| Situación | Qué pasa |
|---|---|
| Oferta nueva | Se analiza, se filtra, se puntúa y se guarda como `new`. |
| Ya estaba como `new` (no la has tocado) y sigue publicada | Vuelve a aparecer en "Ofertas de hoy" sin volver a analizarla. |
| La guardaste (`saved`) y sigue publicada | Se re-analiza; si cambió (horas, horario, salario, modalidad...) se marca **"Actualizada"**. |
| La descartaste (`dismissed`) | **No vuelve a aparecer nunca** (salvo que la restaures en ❌ Descartadas). |
| La descartaron los filtros automáticos | Queda en `job_rejections` y no se re-analiza. |

---

## Decisiones técnicas

Todas comprobadas con la documentación oficial (octubre 2026):

- **Búsqueda web con Claude**: herramientas de servidor oficiales `web_search_20260318` y `web_fetch_20260318` de la API de Claude (las ejecuta Anthropic; `web_fetch` respeta `robots.txt`). La búsqueda cuesta 10 $ por cada 1.000 búsquedas + tokens.
- **LinkedIn e InfoJobs sin scraping**: no hay login, ni credenciales de usuario, ni scraping propio, ni evasión de CAPTCHAs. De LinkedIn/InfoJobs solo se usa lo que aparece **públicamente en los resultados de búsqueda**; `web_fetch` tiene `linkedin.com` e `infojobs.net` en `blocked_domains`, así que Claude no puede leer esas páginas. LinkedIn no ofrece una API pública de búsqueda de empleo.
  Consecuencia honesta: de muchas ofertas de LinkedIn solo se conoce el fragmento del buscador, así que datos como horario o jornada saldrán como "no especificado" y puntuarán menos hasta que abras la oferta.
- **InfoJobs API oficial (opcional)**: `developer.infojobs.net` ofrece una API (`GET /api/9/offer` con filtro `teleworking=solo-teletrabajo`, `GET /api/7/offer/{id}`), autenticada con las credenciales de una *aplicación* registrada. Si añades `INFOJOBS_CLIENT_ID`/`INFOJOBS_CLIENT_SECRET`, el worker la usa; si no, se omite.
- **Modelo**: `claude-opus-5-5` por defecto (configurable). Pensamiento adaptativo y `effort` configurable (búsqueda `medium`, análisis `high`). Fallback del lado del servidor activado (`fallbacks: "default"`): si un clasificador de seguridad rechazara una petición, la API la reintenta en el modelo recomendado.
- **Salida estructurada**: el análisis usa *structured outputs* con un esquema zod y se valida otra vez antes de insertar. La búsqueda entrega las ofertas mediante una herramienta estricta (`strict: true`) y también se valida.
- **Separación de responsabilidades**: Claude extrae datos y valora lo subjetivo (aprendizaje, encaje con ASIR, adecuación del puesto, tecnologías). El **código** aplica los filtros y calcula la nota final: un salario alto nunca compensa un requisito fundamental.
- **GitHub Actions**: `schedule` admite `timezone: "Europe/Madrid"` (gestiona el cambio de hora). Como GitHub puede retrasar o descartar ejecuciones programadas en momentos de carga, la v1 tenía un reintento a las 12:30 (el cron de la v2 se añadirá cuando pase la prueba manual); la tabla `search_runs` (única por usuario y día) impide que se ejecute dos veces.
- **Supabase**: Supabase recomienda las nuevas claves *publishable* (`sb_publishable_...`) y *secret* (`sb_secret_...`); las legacy `anon`/`service_role` dejarán de funcionar a finales de 2026. Ambas sirven con este proyecto (los nombres de las variables se mantienen).
- **Frontend**: React + Vite con `HashRouter` (funciona en GitHub Pages sin reglas de reescritura). Inicio de sesión con Supabase Auth; el registro público se desactiva.
- **Sin npm workspaces**: `worker/` y `web/` son paquetes independientes (además, el disco exFAT donde se creó no admite symlinks).

---

## Instalación

Requisitos: **Node.js ≥ 22.9**, una cuenta de Supabase, una API key de Claude y una cuenta de GitHub.

```bash
git clone <tu-repo> jobfinder && cd jobfinder
npm run install:all     # instala worker/ y web/
npm test                # tests del worker y del frontend
```

---

## Variables de entorno

Plantilla: [`.env.example`](.env.example). **Nunca subas valores reales** (`.env*` está en `.gitignore`).

| Variable | Dónde | Pública | Para qué |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Secret de GitHub / `worker/.env.local` | **No** | API de Claude |
| `SUPABASE_URL` | Secret de GitHub / `worker/.env.local` | sí | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret de GitHub / `worker/.env.local` | **No** | Clave secreta (`sb_secret_...` o `service_role`). Solo worker. |
| `JOBFINDER_USER_ID` | Secret de GitHub / `worker/.env.local` | — | UUID de tu usuario de Supabase Auth |
| `INFOJOBS_CLIENT_ID` / `INFOJOBS_CLIENT_SECRET` | Secret de GitHub (opcional) | **No** | API oficial de InfoJobs |
| `CLAUDE_MODEL`, `CLAUDE_SEARCH_EFFORT`, `CLAUDE_EVAL_EFFORT`, `MAX_SEARCHES_PER_BATCH`, `MAX_FETCHES_PER_BATCH` | Variable de GitHub (opcional) | sí | Ajustes de coste/calidad |
| `VITE_SUPABASE_URL` | Variable de GitHub / `web/.env.local` | sí | Frontend |
| `VITE_SUPABASE_ANON_KEY` | Variable de GitHub / `web/.env.local` | sí | Clave **pública** (`sb_publishable_...` o `anon`) |

> `SUPABASE_ANON_KEY` (sin `VITE_`) no se usa: el worker no la necesita, y el frontend usa `VITE_SUPABASE_ANON_KEY` porque Vite solo expone variables con ese prefijo.

---

## Configuración de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **Aplica el schema**: abre *SQL Editor*, pega el contenido de [`supabase/migrations/20261005000000_init.sql`](supabase/migrations/20261005000000_init.sql) y ejecútalo.
   (Alternativa con la CLI de Supabase: `supabase link --project-ref <ref>` y `supabase db push`.)
3. **Desactiva el registro público**: *Authentication → Sign In / Providers →* desactiva *Allow new users to sign up*.
4. **Crea tu usuario**: *Authentication → Users → Add user* (email + contraseña, marca *Auto Confirm User*).
5. Copia el **UUID** del usuario → será `JOBFINDER_USER_ID`.
6. *Project Settings → API Keys*: copia la **Publishable key** (frontend) y crea/copia una **Secret key** (worker). Copia también la **Project URL**.
7. *Authentication → URL Configuration*: añade la URL de GitHub Pages (`https://<usuario>.github.io/<repo>/`) como *Site URL* / *Redirect URL*.

**Seguridad (RLS)** — comprobada con tests sobre Postgres:
- `anon` no puede leer nada.
- Un usuario autenticado solo **lee sus filas** y solo puede **cambiar `status` e `is_updated`** de sus ofertas (privilegios por columna). No puede insertar, borrar ni modificar el contenido, la puntuación ni el historial.
- Solo el worker (clave secreta) escribe ofertas.

---

## Configuración de Claude

1. Crea una API key en [platform.claude.com](https://platform.claude.com) → *API keys*.
2. Asegúrate de que la **búsqueda web** está habilitada para tu organización (*Settings → Capabilities*). Si no, la API devuelve un 400 indicándolo.
3. Opcional: pon un límite de gasto mensual en la consola.

**Coste orientativo**: 4 lotes × máx. 10 búsquedas = máx. 40 búsquedas/día (≤ 0,40 $/día en búsquedas) más tokens de Claude Opus 5.5 (4 $/MTok entrada, 20 $/MTok salida). Cada ejecución registra los tokens usados (`stats.tokens` en `search_runs` y en el resumen de Actions) para que veas el gasto real. Para reducirlo: baja `MAX_SEARCHES_PER_BATCH`, `CLAUDE_EVAL_EFFORT=medium` o usa `CLAUDE_MODEL=claude-sonnet-5-5`.

---

## Configuración de GitHub Actions

1. Sube el repositorio a GitHub (rama `main`; los cron solo se ejecutan desde la rama por defecto).
2. *Settings → Secrets and variables → Actions*:
   - **Secrets**: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JOBFINDER_USER_ID` (y opcionalmente `INFOJOBS_CLIENT_ID`, `INFOJOBS_CLIENT_SECRET`).
   - **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (y opcionalmente `CLAUDE_MODEL`, etc.).
3. *Actions*: habilita los workflows si GitHub lo pide.

Workflows:

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `job-search-v2.yml` | Manual (de momento) | v2: fuentes oficiales → filtros → Claude (suscripción) → Supabase. |
| `daily-job-search.yml` | Solo manual | v1 legacy con API de pago (requiere `ANTHROPIC_API_KEY`; la v2 exige que no exista). |
| `ci.yml` | push / PR | Typecheck + tests + build. |
| `deploy-pages.yml` | push a `main` en `web/` + manual | Publica el panel en GitHub Pages. |

> ⚠️ En repositorios **públicos**, GitHub desactiva los workflows programados tras **60 días sin actividad** en el repo. Si pasa, reactívalo en *Actions* o haz cualquier commit.

---

## Desplegar el frontend (GitHub Pages)

1. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
2. Define las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (paso anterior).
3. Haz push a `main` o ejecuta *Desplegar panel web* manualmente.
4. Abre `https://<usuario>.github.io/<repo>/` en el móvil, tablet o PC e inicia sesión.

> GitHub Pages en repositorios privados requiere un plan de pago de GitHub. El panel no expone datos aunque sea público: sin iniciar sesión no se ve nada (RLS).

En local:

```bash
cp web/.env.example web/.env.local   # rellena URL y clave pública
npm run dev                          # http://localhost:5173
```

---

## Cambiar el perfil

Edita [`worker/src/config/profile.ts`](worker/src/config/profile.ts): ubicación, formación, experiencia, idiomas y conocimientos (`"sí" | "básico" | "no"`). Claude recibe exactamente ese perfil, sin añadir nada. Haz commit y push: la siguiente ejecución lo usa.

## Cambiar preferencias y puntuación

[`worker/src/config/preferences.ts`](worker/src/config/preferences.ts):

| Preferencia | Valor actual |
|---|---|
| Horas ideales / máximas | ≤ 20 h ideal · 21–25 h solo si es muy buena · > 25 h o jornada completa: descarte |
| Horario | Desde las 16:00 (empezar antes → descarte; exigir mañanas → descarte) |
| Modalidad | Solo 100% remoto (híbrido/presencial → descarte) |
| Ubicación | Debe permitir trabajar desde España (si es ambigua, se avisa) |
| Inglés | Avanzado/fluido/nativo → descarte · B2 → −15 · intermedio → −6 |
| Seniority | Senior / lead / manager → descarte |
| Sin salario | −2 puntos (nunca descarte) |
| Prioridad | 🟢 ≥ 75 (solo con remoto confirmado y ≤ 20 h) · 🟡 ≥ 55 · ⚪ resto |
| Guardar | Ofertas que pasan filtros con nota ≥ 35 |

Pesos de la nota (suman 100, en tu orden de prioridades): horario 20 · remoto 16 · jornada 15 · aprendizaje 14 · encaje ASIR 10 · puesto 9 · experiencia 7 · salario 4 · tecnologías 3 · otros 2.

- Las **consultas de búsqueda** están en [`searchQueries.ts`](worker/src/config/searchQueries.ts).
- Los **filtros duros** en [`hardFilters.ts`](worker/src/scoring/hardFilters.ts) y la **nota** en [`score.ts`](worker/src/scoring/score.ts).
- Los **criterios que sigue Claude** en [`prompts.ts`](worker/src/claude/prompts.ts).

Tras cambiar algo, ejecuta `npm test` (los tests incluyen tus ejemplos: 40 h + 3000 € → descarte; 20 h + tardes + formación → excelente; 25 h + formación → interesante; turno 10–14 → descarte).

---

## Ejecutar una búsqueda manual

**En GitHub** (recomendado): *Actions → Búsqueda diaria de ofertas → Run workflow*. Marca **force** para repetirla si la de hoy ya se hizo.

**En local**:

```bash
cp .env.example worker/.env.local   # rellena los valores
npm run search                      # búsqueda real (guarda en Supabase)
npm run search -- --force           # repetir aunque hoy ya se haya hecho
npm run search:dry                  # SIN Supabase: solo necesita ANTHROPIC_API_KEY;
                                    # resultado en worker/logs/dry-run-<fecha>.json
```

---

## Logs

Cada ejecución registra (JSON por línea, sin claves ni secretos — se redactan automáticamente):

- inicio, fecha de Madrid, intento y disparador;
- búsquedas web, páginas leídas y resultados por lote;
- ofertas identificadas, únicas, ya conocidas, descartadas por ti, descartadas por filtros (con motivo), por nota baja, guardadas y actualizadas;
- errores de cada fuente, de Claude y de Supabase;
- tokens usados.

Dónde verlos: resumen en la página de cada ejecución de Actions, artefacto `jobfinder-logs-*` (30 días), tabla `search_runs` (estadísticas y errores) e "Historial de búsquedas" en 🏠 Inicio.

---

## Tests

```bash
npm test             # worker + web
npm run typecheck
```

- `worker/test/scoring.test.ts` — filtros duros y puntuación (incluye tus ejemplos).
- `worker/test/dedup.test.ts` — URLs canónicas de LinkedIn/InfoJobs, huellas, deduplicación.
- `worker/test/pipeline.test.ts` — flujo completo con Claude simulado: doble ejecución, descartadas que no vuelven, actualizadas, rechazos.
- `worker/test/schema.test.ts` — el SQL real sobre Postgres embebido (PGlite): restricciones, triggers e **RLS**.
- `worker/test/misc.test.ts` — fechas de Madrid, redacción de secretos, configuración, esquemas JSON.
- `web/src/lib/web.test.ts` — textos de tarjeta ("no especificado") y filtros.

---

## Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| `Configuración inválida: ...` | Falta un secret o tiene formato incorrecto (p. ej. `JOBFINDER_USER_ID` no es un UUID). El mensaje dice cuál. |
| `Claude: API key inválida o sin permisos (401)` | Revisa `ANTHROPIC_API_KEY`. La búsqueda se detiene en el primer lote. |
| `Claude: petición inválida (400) ... web search` | La búsqueda web está desactivada en tu organización de Claude (*Settings → Capabilities*). |
| `Claude: límite de uso alcanzado (429)` | Límite de tu cuenta; baja `MAX_SEARCHES_PER_BATCH` o espera. |
| `Supabase: error al ... (42501)` / `permission denied` | Estás usando la clave pública en el worker: usa la **secret / service_role**. |
| `Supabase: error al leer search_runs ... does not exist` | No aplicaste la migración SQL. |
| `Búsqueda omitida: La búsqueda del ... ya se ejecutó` | Normal (protección contra dobles ejecuciones). Usa *force* para repetir. |
| Ejecución "running" colgada | Tras 3 h se considera colgada y la siguiente ejecución la reintenta (o usa *force*). |
| El cron no se ejecuta | Debe estar en `main`; en repos públicos se desactiva tras 60 días sin actividad; GitHub puede retrasar ejecuciones. Nota: ahora mismo ningún workflow tiene cron (la v2 está en prueba manual). |
| El panel muestra "Falta configuración" | Faltan `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` al construir. |
| No puedo iniciar sesión | Usuario no creado o no confirmado en Supabase Auth; revisa también la *Site URL*. |
| El panel no muestra ofertas | Comprueba que `JOBFINDER_USER_ID` es el UUID del mismo usuario con el que inicias sesión. |
| Muchas ofertas con "Horario no especificado" | Esperable en ofertas de LinkedIn/InfoJobs vistas solo por el buscador. Activa la API oficial de InfoJobs para tener más datos. |
