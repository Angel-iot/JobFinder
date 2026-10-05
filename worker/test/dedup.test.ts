import { describe, expect, it } from "vitest";
import { dedupeCandidates, findExisting } from "../src/dedup/dedup.js";
import { canonicalizeUrl, contentHash, externalIdFromUrl, fingerprint, sourceFromUrl } from "../src/dedup/identity.js";
import { rawCandidate } from "./fixtures.js";

describe("URL canónica e ID externo", () => {
  it("LinkedIn: variantes de la misma oferta → misma URL", () => {
    const a = canonicalizeUrl("https://es.linkedin.com/jobs/view/tecnico-helpdesk-at-acme-3912345678?trk=public_jobs&refId=abc");
    const b = canonicalizeUrl("https://www.linkedin.com/jobs/view/3912345678/");
    const c = canonicalizeUrl("https://www.linkedin.com/jobs/search/?currentJobId=3912345678&keywords=helpdesk");
    expect(a).toBe("https://www.linkedin.com/jobs/view/3912345678");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(externalIdFromUrl(a)).toBe("3912345678");
  });

  it("InfoJobs: usa el ID de la oferta", () => {
    const url = "https://www.infojobs.net/valencia/tecnico-helpdesk/of-i1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c?applicationOrigin=search-new";
    expect(externalIdFromUrl(url)).toBe("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c");
    expect(canonicalizeUrl(url)).toBe("https://www.infojobs.net/of-i1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c");
  });

  it("otras webs: quita tracking, fragmento, www y barra final", () => {
    expect(canonicalizeUrl("http://www.Example.com/jobs/123/?utm_source=x&b=2&a=1#apply")).toBe("https://example.com/jobs/123?a=1&b=2");
  });

  it("fuente a partir de la URL", () => {
    expect(sourceFromUrl("https://es.linkedin.com/jobs/view/1")).toBe("linkedin");
    expect(sourceFromUrl("https://www.infojobs.net/x")).toBe("infojobs");
    expect(sourceFromUrl("https://www.remoteok.com/x")).toBe("remoteok.com");
  });
});

describe("huella y hash", () => {
  it("misma empresa+título en distintas fuentes → misma huella", () => {
    expect(fingerprint("Técnico Helpdesk (H/M) - Remoto", "Acme Soluciones S.L.", "u1")).toBe(
      fingerprint("tecnico helpdesk", "ACME SOLUCIONES", "u2"),
    );
  });

  it("sin empresa la huella depende de la URL (no se fusionan ofertas distintas)", () => {
    expect(fingerprint("Helpdesk", null, "u1")).not.toBe(fingerprint("Helpdesk", null, "u2"));
  });

  it("el hash de contenido cambia si cambian las horas", () => {
    const base = {
      title: "Helpdesk",
      company: "Acme",
      remote_type: "full_remote",
      employment_type: "part_time",
      hours_per_week: 20,
      schedule: "16-20",
      salary_min: null,
      salary_max: null,
      english_level: "none",
      experience_years_min: null,
    };
    expect(contentHash(base)).toBe(contentHash({ ...base }));
    expect(contentHash(base)).not.toBe(contentHash({ ...base, hours_per_week: 30 }));
  });
});

describe("deduplicación", () => {
  it("fusiona la misma oferta vista en LinkedIn y en la web de la empresa", () => {
    const result = dedupeCandidates([
      rawCandidate({ url: "https://acme.com/careers/helpdesk", details: "Página completa", details_origin: "full_page" }),
      rawCandidate({
        url: "https://es.linkedin.com/jobs/view/helpdesk-3912345678?trk=x",
        details: "Snippet",
        details_origin: "search_snippet",
      }),
      rawCandidate({ url: "https://acme.com/careers/helpdesk?utm_campaign=y" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.canonical_url).toBe("https://acme.com/careers/helpdesk");
    expect(result[0]!.alternate_urls).toContain("https://www.linkedin.com/jobs/view/3912345678");
  });

  it("no fusiona ofertas distintas", () => {
    const result = dedupeCandidates([
      rawCandidate({ url: "https://a.com/1", title: "Helpdesk", company: "A" }),
      rawCandidate({ url: "https://b.com/2", title: "Técnico de sistemas", company: "B" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("encuentra una oferta existente por ID externo", () => {
    const [c] = dedupeCandidates([rawCandidate({ url: "https://www.linkedin.com/jobs/view/3912345678", company: "Otra" })]);
    const existing = {
      canonical_url: "https://www.linkedin.com/jobs/view/3912345678",
      source: "linkedin",
      external_id: "3912345678",
      fingerprint: "x",
      alternate_urls: [],
    };
    expect(findExisting(c!, [existing])).toBe(existing);
  });
});
