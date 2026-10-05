import { describe, expect, it } from "vitest";
import { fetchArbeitnow, fetchHimalayas, fetchRemoteOk, fetchRemotive } from "../../src/v2/sources/remoteBoards.js";
import { fetchAdzuna, infojobsHints } from "../../src/v2/sources/spainSources.js";
import { v2Env } from "./fixtures.js";

/** fetch simulado: responde según la URL y registra las peticiones. */
function mockFetch(routes: Record<string, unknown>, calls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("Himalayas", () => {
  it("busca con country=ES y marca que admite España", async () => {
    const calls: string[] = [];
    const r = await fetchHimalayas({
      delayMs: 0,
      fetchImpl: mockFetch(
        {
          "https://himalayas.app/jobs/api/search": {
            jobs: [
              {
                title: "IT Support Technician",
                companyName: "Acme",
                employmentType: "Part Time",
                minSalary: null,
                seniority: ["Entry-level"],
                locationRestrictions: ["Spain", "Portugal"],
                description: "<p>Help users</p>",
                pubDate: 1791229000,
                guid: "https://himalayas.app/companies/acme/jobs/it-support",
              },
            ],
          },
        },
        calls,
      ),
    });
    expect(calls.every((u) => u.includes("country=ES"))).toBe(true);
    expect(r.candidates[0]!.hints.spain_allowed_by_query).toBe(true);
    expect(r.candidates[0]!.hints.employment_type).toBe("part_time");
    expect(r.candidates[0]!.details).toBe("Help users");
    expect(r.candidates[0]!.hints.salary_min).toBeNull();
  });
});

describe("Remotive / Remote OK / Arbeitnow", () => {
  it("Remotive: una sola petición y restricción geográfica literal", async () => {
    const calls: string[] = [];
    const r = await fetchRemotive({
      fetchImpl: mockFetch(
        {
          "https://remotive.com/api/remote-jobs": {
            "0-legal-notice": "...",
            jobs: [{ url: "https://remotive.com/remote-jobs/x-1", title: "Helpdesk", company_name: "X", job_type: "part_time", publication_date: "2026-10-02T20:01:00", candidate_required_location: "Europe", description: "<b>hi</b>" }],
          },
        },
        calls,
      ),
    });
    expect(calls).toHaveLength(1);
    expect(r.candidates[0]!.hints.location_restriction).toBe("Europe");
    expect(r.candidates[0]!.hints.employment_type).toBe("part_time");
  });

  it("Remote OK: ignora el aviso legal del primer elemento", async () => {
    const r = await fetchRemoteOk({
      fetchImpl: mockFetch({
        "https://remoteok.com/api": [{ legal: "API Terms..." }, { position: "Desktop Support", company: "Y", url: "https://remoteOK.com/remote-jobs/y", tags: ["part time"], salary_min: 0, salary_max: 0 }],
      }),
    });
    expect(r.fetched).toBe(1);
    expect(r.candidates[0]!.hints.employment_type).toBe("part_time");
    expect(r.candidates[0]!.hints.salary_min).toBeNull(); // 0 = no publicado
  });

  it("Arbeitnow: solo ofertas marcadas como remotas", async () => {
    const r = await fetchArbeitnow({
      delayMs: 0,
      fetchImpl: mockFetch({
        "https://www.arbeitnow.com/api/job-board-api": {
          data: [
            { title: "IT-Support", url: "https://www.arbeitnow.com/jobs/a", remote: true, location: "Berlin" },
            { title: "IT-Support vor Ort", url: "https://www.arbeitnow.com/jobs/b", remote: false, location: "Berlin" },
          ],
          links: { next: null },
        },
      }),
    });
    expect(r.candidates.map((c) => c.url)).toEqual(["https://www.arbeitnow.com/jobs/a"]);
  });

  it("los errores HTTP se registran y no rompen la ejecución", async () => {
    const r = await fetchRemotive({ fetchImpl: mockFetch({}) });
    expect(r.candidates).toHaveLength(0);
    expect(r.errors[0]).toMatch(/404/);
  });
});

describe("Fuentes españolas opcionales", () => {
  it("Adzuna desactivada sin credenciales y sin peticiones", async () => {
    const calls: string[] = [];
    const r = await fetchAdzuna(v2Env("w"), { fetchImpl: mockFetch({}, calls) });
    expect(r.enabled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("Adzuna: no usa salarios estimados y no filtra la app_key en errores", async () => {
    const env = { ...v2Env("w"), ADZUNA_APP_ID: "id", ADZUNA_APP_KEY: "secretkey123" };
    const ok = await fetchAdzuna(env, {
      delayMs: 0,
      fetchImpl: mockFetch({
        "https://api.adzuna.com": {
          results: [{ title: "Técnico helpdesk", redirect_url: "https://www.adzuna.es/land/ad/1", salary_min: 18000, salary_is_predicted: "1", contract_time: "part_time" }],
        },
      }),
    });
    expect(ok.candidates[0]!.hints.salary_min).toBeNull();
    expect(ok.candidates[0]!.hints.employment_type).toBe("part_time");
    const failing = await fetchAdzuna(env, { delayMs: 0, fetchImpl: mockFetch({}) });
    expect(failing.errors.join(" ")).not.toContain("secretkey123");
  });

  it("InfoJobs: interpreta teletrabajo y jornada de la API oficial", () => {
    const h = infojobsHints("Teletrabajo: Solo teletrabajo\nJornada: Parcial - Tarde");
    expect(h.remote_board).toBe(true);
    expect(h.employment_type).toBe("part_time");
    expect(h.workday_text).toBe("Parcial - Tarde");
  });
});
