import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getAccessToken, _resetTokenCacheForTests } from "../auth.js";

const PAGE_ID = "PAGE123";
const USER_TOKEN = "user-token-abc";
const PAGE_TOKEN = "page-token-xyz";

describe("getAccessToken — F13 Page-token auto-exchange", () => {
  beforeEach(() => {
    _resetTokenCacheForTests();
    process.env.META_ORGANIC_ACCESS_TOKEN = USER_TOKEN;
    process.env.META_ORGANIC_PAGE_ID = PAGE_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges the configured token for the Page token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: PAGE_TOKEN }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAccessToken();

    expect(token).toBe(PAGE_TOKEN);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`/${PAGE_ID}?fields=access_token`);
    expect(url).toContain(`access_token=${USER_TOKEN}`);
  });

  it("resolves once and caches across repeated calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: PAGE_TOKEN }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await getAccessToken();
    await getAccessToken();
    await getAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the configured token when the exchange returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "bad token" } }),
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await getAccessToken()).toBe(USER_TOKEN);
  });

  it("falls back to the configured token when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await getAccessToken()).toBe(USER_TOKEN);
  });

  it("returns the configured token unchanged when no Page ID is set", async () => {
    delete process.env.META_ORGANIC_PAGE_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken()).toBe(USER_TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
