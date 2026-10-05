/**
 * Consultas de búsqueda. Se agrupan en lotes: cada lote es una conversación de
 * Claude con la herramienta oficial de búsqueda web. Claude puede adaptar y
 * ampliar las consultas según los resultados (el prompt se lo pide).
 *
 * Prioridad de fuentes: LinkedIn → InfoJobs → resto de fuentes públicas.
 */

export interface QueryBatch {
  id: string;
  /** Descripción para los logs. */
  focus: string;
  queries: string[];
}

export const queryBatches: QueryBatch[] = [
  {
    id: "linkedin",
    focus: "Ofertas públicas de LinkedIn (linkedin.com/jobs)",
    queries: [
      'site:linkedin.com/jobs "helpdesk" remoto España media jornada',
      'site:linkedin.com/jobs "IT support" remote Spain part time',
      'site:linkedin.com/jobs "service desk" remote Spain junior',
      'site:linkedin.com/jobs "técnico de sistemas" junior remoto',
      'site:linkedin.com/jobs "technical support" remote Europe part-time',
      'site:linkedin.com/jobs "soporte informático" teletrabajo tarde',
    ],
  },
  {
    id: "infojobs",
    focus: "Ofertas públicas de InfoJobs (infojobs.net)",
    queries: [
      'site:infojobs.net "técnico informático" teletrabajo jornada parcial',
      'site:infojobs.net helpdesk teletrabajo tarde',
      'site:infojobs.net "técnico de sistemas" junior 100% remoto',
      'site:infojobs.net "soporte técnico" teletrabajo media jornada',
      'site:infojobs.net "service desk" remoto parcial',
    ],
  },
  {
    id: "remote-boards",
    focus: "Portales de empleo remoto y portales IT especializados",
    queries: [
      '"IT support" remote Europe part-time junior',
      '"helpdesk" remote Spain 20 hours',
      '"Linux support" remote junior Europe',
      '"desktop support" remote part time Europe',
      'tecnoempleo técnico soporte teletrabajo media jornada',
      '"sysadmin junior" remote Spain',
    ],
  },
  {
    id: "spanish-general",
    focus: "Búsqueda general en español, webs de empresas y páginas de careers",
    queries: [
      '"técnico informático" remoto media jornada tarde',
      '"técnico de soporte" 100% remoto 20 horas',
      '"técnico helpdesk" teletrabajo turno de tarde',
      '"soporte IT" remoto jornada parcial junior España',
      '"técnico de sistemas junior" remoto empleo',
      'careers "IT support" "part-time" "remote" Spain',
    ],
  },
];
