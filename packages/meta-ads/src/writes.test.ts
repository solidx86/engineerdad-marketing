import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCampaign, createAdCreative, uploadImage } from "./writes.js";

describe("uploadImage — file_url fetches bytes then uploads multipart (url-mode is capability-gated)", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const urlOf = (c: unknown[]): string => {
    const a = c[0];
    return a instanceof URL ? a.href : String(a);
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["META_TOKEN"] = "tok_x";
    process.env["AD_ACCOUNT_ID"] = "act_123";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.includes("/adimages")) {
        return new Response(
          JSON.stringify({ images: { "1.png": { hash: "h_abc", url: "https://img/h_abc" } } }),
          { status: 200 },
        );
      }
      // the asset fetch — return a few PNG-signature bytes
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  it("fetches the asset then POSTs multipart FormData to /adimages (never url-mode)", async () => {
    const res = await uploadImage({ file_url: "https://assets.example/run/abc/1.png" });

    const calls = fetchSpy.mock.calls;
    // 1) the asset URL itself was fetched (to read the bytes)
    expect(calls.some((c) => urlOf(c) === "https://assets.example/run/abc/1.png")).toBe(true);

    // 2) the /adimages call is a multipart POST (FormData body), NOT a urlencoded url= post
    const adimagesCall = calls.find((c) => urlOf(c).includes("/adimages"))!;
    expect(adimagesCall).toBeDefined();
    const init = adimagesCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(typeof init.body).not.toBe("string"); // url-mode sent a urlencoded string body with url=

    // 3) returns the parsed hash + multipart mode
    expect(res.image_hash).toBe("h_abc");
    expect(res.mode).toBe("multipart");
  });

  it("throws a clear error when the asset URL is unreachable", async () => {
    fetchSpy.mockImplementation((async (input: unknown) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.includes("/adimages")) return new Response("{}", { status: 200 });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch);

    await expect(
      uploadImage({ file_url: "https://assets.example/missing.png" }),
    ).rejects.toThrow(/file_url|404|fetch/i);
  });
});

describe("createCampaign — is_adset_budget_sharing_enabled", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["META_TOKEN"] = "tok_x";
    process.env["AD_ACCOUNT_ID"] = "act_123";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cmp_1" }), { status: 200 }),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  it("forwards is_adset_budget_sharing_enabled=true when explicitly true", async () => {
    await createCampaign({
      name: "Test Campaign A",
      objective: "OUTCOME_TRAFFIC",
      is_adset_budget_sharing_enabled: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0]!;
    const init = call[1] as RequestInit;
    const body = String(init.body);
    expect(body).toContain("is_adset_budget_sharing_enabled");
    expect(body).toContain("is_adset_budget_sharing_enabled=true");
  });

  it("defaults is_adset_budget_sharing_enabled to false when omitted", async () => {
    await createCampaign({
      name: "Test Campaign B",
      objective: "OUTCOME_TRAFFIC",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = String((fetchSpy.mock.calls[0]![1] as RequestInit).body);
    expect(body).toContain("is_adset_budget_sharing_enabled=false");
  });
});

describe("createAdCreative — env defaults + CTA coercion", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env["META_TOKEN"] = "tok_x";
    process.env["AD_ACCOUNT_ID"] = "act_123";
    process.env["META_ORGANIC_PAGE_ID"] = "page_777";
    process.env["LANDING_URL"] = "https://engineerdad.my";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cre_1" }), { status: 200 }),
    );
  });
  afterEach(() => {
    process.env = originalEnv;
    fetchSpy.mockRestore();
  });

  // primary_text contains "past performance" — passes the EN compliance sentinel check.
  const base = {
    name: "c1",
    primary_text: "Past performance is not guaranteed.",
    image_hash: "h1",
    lang: "en" as const,
  };

  function formBody(): string {
    return String((fetchSpy.mock.calls[0]![1] as RequestInit).body);
  }

  it("defaults page_id from META_ORGANIC_PAGE_ID when absent", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    expect(formBody()).toContain("page_777");
  });

  it("defaults link_url from LANDING_URL when absent", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    expect(decodeURIComponent(formBody())).toContain("https://engineerdad.my");
  });

  it("coerces a bare-string call_to_action into {type, value:{link}}", async () => {
    await createAdCreative({ ...base, call_to_action: "LEARN_MORE" });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain('"type":"LEARN_MORE"');
    expect(decoded).toContain('"link":"https://engineerdad.my"');
  });

  it("passes an object-shape call_to_action through, filling value.link when missing", async () => {
    await createAdCreative({ ...base, call_to_action: { type: "SIGN_UP" } });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain('"type":"SIGN_UP"');
    expect(decoded).toContain('"link":"https://engineerdad.my"');
  });

  it("preserves extra value keys alongside env-defaulted link when value.link is absent", async () => {
    await createAdCreative({
      ...base,
      call_to_action: { type: "WHATSAPP_MESSAGE", value: { whatsapp_number: "60123456789" } },
    });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain('"type":"WHATSAPP_MESSAGE"');
    expect(decoded).toContain('"whatsapp_number":"60123456789"');
    expect(decoded).toContain('"link":"https://engineerdad.my"');
  });

  it("honors explicit page_id/link_url over env", async () => {
    await createAdCreative({ ...base, page_id: "page_explicit", link_url: "https://lp.example", call_to_action: "LEARN_MORE" });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).toContain("page_explicit");
    expect(decoded).toContain("https://lp.example");
  });

  it("omits call_to_action from the form when not provided", async () => {
    await createAdCreative({ ...base });
    const decoded = decodeURIComponent(formBody());
    expect(decoded).not.toContain("call_to_action=undefined");
  });
});
