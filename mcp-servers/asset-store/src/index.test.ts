import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { upload } from "./index.js";
import { _resetClientForTests } from "./r2.js";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// S3Client mock — every test that exercises the R2 path inspects this spy.
const sendSpy = vi.fn();
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({ send: sendSpy })),
    HeadObjectCommand: vi.fn().mockImplementation((args) => ({ __cmd: "Head", ...args })),
    PutObjectCommand: vi.fn().mockImplementation((args) => ({ __cmd: "Put", ...args })),
  };
});

const R2_ENV = {
  ASSET_STORE_R2_BUCKET: "meta",
  R2_ACCOUNT_ID: "abc123",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

function enableR2() {
  for (const [k, v] of Object.entries(R2_ENV)) process.env[k] = v;
}

function notFoundError() {
  const err = new Error("NotFound");
  (err as { name: string }).name = "NotFound";
  return err;
}

// 1×1 transparent PNG, base64
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("asset-store upload", () => {
  let tmp: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "asset-store-test-"));
    process.env["ASSET_STORE_ROOT"] = tmp;
    sendSpy.mockReset();
    _resetClientForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a base64 PNG to the expected path", async () => {
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 1,
      ext: "png",
    });
    expect(result.path).toBe(join(tmp, "run_test", "variant_abc", "1.png"));
    expect(existsSync(result.path)).toBe(true);
    const written = readFileSync(result.path);
    expect(written.equals(Buffer.from(TINY_PNG_B64, "base64"))).toBe(true);
  });

  it("returns sha256 matching the buffer", async () => {
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: "intro",
      ext: "png",
    });
    const expected = createHash("sha256").update(Buffer.from(TINY_PNG_B64, "base64")).digest("hex");
    expect(result.sha256).toBe(expected);
    expect(result.bytes).toBe(Buffer.from(TINY_PNG_B64, "base64").length);
  });

  it("rejects path-traversal attempts in run_id", async () => {
    await expect(
      upload({
        data_base64: TINY_PNG_B64,
        mime_type: "image/png",
        run_id: "../etc",
        variant_id: "variant_abc",
        scene_id: 1,
        ext: "png",
      }),
    ).rejects.toThrow(/run_id must match/);
  });

  it("rejects path-traversal in variant_id and ext", async () => {
    await expect(
      upload({
        data_base64: TINY_PNG_B64,
        mime_type: "image/png",
        run_id: "run_test",
        variant_id: "../../escape",
        scene_id: 1,
        ext: "png",
      }),
    ).rejects.toThrow(/variant_id must match/);

    await expect(
      upload({
        data_base64: TINY_PNG_B64,
        mime_type: "image/png",
        run_id: "run_test",
        variant_id: "variant_abc",
        scene_id: 1,
        ext: "png/../bad",
      }),
    ).rejects.toThrow(/ext must match/);
  });

  it("ingests an existing local file via local_path", async () => {
    const src = join(tmp, "external.png");
    writeFileSync(src, Buffer.from(TINY_PNG_B64, "base64"));
    const result = await upload({
      local_path: src,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 2,
      ext: "png",
    });
    expect(result.path).toBe(join(tmp, "run_test", "variant_abc", "2.png"));
    expect(existsSync(result.path)).toBe(true);
    const written = readFileSync(result.path);
    expect(written.equals(Buffer.from(TINY_PNG_B64, "base64"))).toBe(true);
  });

  it("is a no-op when local_path is already the canonical path", async () => {
    // Simulate static-renderer having written to the canonical asset-store path.
    const canonical = join(tmp, "run_test", "variant_abc", "3.png");
    writeFileSync(join(tmp, "external.png"), Buffer.from(TINY_PNG_B64, "base64")); // dummy
    // First, populate the canonical path via a normal upload.
    await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 3,
      ext: "png",
    });
    expect(existsSync(canonical)).toBe(true);
    const beforeMtime = readFileSync(canonical);
    // Now re-register the same path through local_path — should not throw and
    // should return the same sha + url.
    const result = await upload({
      local_path: canonical,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 3,
      ext: "png",
    });
    expect(result.path).toBe(canonical);
    const after = readFileSync(canonical);
    expect(after.equals(beforeMtime)).toBe(true);
  });

  it("returns file:// url by default", async () => {
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 4,
      ext: "png",
    });
    expect(result.url).toBe(pathToFileURL(result.path).toString());
    expect(result.url.startsWith("file://")).toBe(true);
  });

  it("uses ASSET_STORE_PUBLIC_BASE to build https URL when set", async () => {
    process.env["ASSET_STORE_PUBLIC_BASE"] = "https://cdn.example.com/assets";
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 5,
      ext: "png",
    });
    expect(result.url).toBe(
      "https://cdn.example.com/assets/run_test/variant_abc/5.png",
    );
  });

  it("rejects requests with both data_base64 and local_path", async () => {
    const src = join(tmp, "external.png");
    writeFileSync(src, Buffer.from(TINY_PNG_B64, "base64"));
    await expect(
      upload({
        data_base64: TINY_PNG_B64,
        local_path: src,
        mime_type: "image/png",
        run_id: "run_test",
        variant_id: "variant_abc",
        scene_id: 6,
        ext: "png",
      }),
    ).rejects.toThrow(/exactly one of/);
  });

  it("rejects requests with neither data_base64 nor local_path", async () => {
    await expect(
      upload({
        mime_type: "image/png",
        run_id: "run_test",
        variant_id: "variant_abc",
        scene_id: 7,
        ext: "png",
      }),
    ).rejects.toThrow(/exactly one of/);
  });

  it("does NOT touch R2 when env is unset (local-disk-only mode)", async () => {
    await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 1,
      ext: "png",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("mirrors to R2 when env is set: Head 404 → Put", async () => {
    enableR2();
    // First send() is the HeadObject existence probe — return 404.
    sendSpy.mockRejectedValueOnce(notFoundError());
    // Second send() is the PutObject — succeed.
    sendSpy.mockResolvedValueOnce({});
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 1,
      ext: "png",
    });
    expect(sendSpy).toHaveBeenCalledTimes(2);
    const head = sendSpy.mock.calls[0]![0] as {
      __cmd: string;
      Bucket: string;
      Key: string;
    };
    expect(head.__cmd).toBe("Head");
    expect(head.Bucket).toBe("meta");
    expect(head.Key).toBe("run_test/variant_abc/1.png");
    const put = sendSpy.mock.calls[1]![0] as {
      __cmd: string;
      Bucket: string;
      Key: string;
      ContentType: string;
      CacheControl: string;
    };
    expect(put.__cmd).toBe("Put");
    expect(put.Bucket).toBe("meta");
    expect(put.Key).toBe("run_test/variant_abc/1.png");
    expect(put.ContentType).toBe("image/png");
    expect(put.CacheControl).toBe("public, max-age=31536000, immutable");
    expect(result.bytes).toBe(Buffer.from(TINY_PNG_B64, "base64").length);
  });

  it("skips PutObject when R2 HeadObject returns 200 (idempotent re-run)", async () => {
    enableR2();
    // HeadObject succeeds → object already exists → no Put.
    sendSpy.mockResolvedValueOnce({});
    await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_test",
      variant_id: "variant_abc",
      scene_id: 1,
      ext: "png",
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const head = sendSpy.mock.calls[0]![0] as { __cmd: string };
    expect(head.__cmd).toBe("Head");
  });

  it("propagates non-404 R2 errors so the caller knows the URL won't work", async () => {
    enableR2();
    const authErr = Object.assign(new Error("InvalidAccessKeyId"), {
      name: "InvalidAccessKeyId",
      $metadata: { httpStatusCode: 403 },
    });
    sendSpy.mockRejectedValueOnce(authErr);
    await expect(
      upload({
        data_base64: TINY_PNG_B64,
        mime_type: "image/png",
        run_id: "run_test",
        variant_id: "variant_abc",
        scene_id: 1,
        ext: "png",
      }),
    ).rejects.toThrow(/InvalidAccessKeyId/);
  });

  it("uses ASSET_STORE_PUBLIC_BASE for the returned URL even when R2 is enabled", async () => {
    enableR2();
    process.env["ASSET_STORE_PUBLIC_BASE"] = "https://assets.engineerdad.my";
    sendSpy.mockRejectedValueOnce(notFoundError());
    sendSpy.mockResolvedValueOnce({});
    const result = await upload({
      data_base64: TINY_PNG_B64,
      mime_type: "image/png",
      run_id: "run_1",
      variant_id: "v_a",
      scene_id: 3,
      ext: "png",
    });
    expect(result.url).toBe("https://assets.engineerdad.my/run_1/v_a/3.png");
  });
});
