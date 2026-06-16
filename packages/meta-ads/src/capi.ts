import { createHash } from "node:crypto";

const META_API_VERSION = "v21.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export type CapiEventName =
  | "Lead"
  | "Purchase"
  | "CompleteRegistration"
  | "ViewContent"
  | "AddToCart"
  | "Contact";

export type ActionSource = "website" | "system_generated" | "app";

export interface CapiUserData {
  em?: string[];
  ph?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

export interface CapiCustomData {
  value?: number;
  currency?: "MYR";
  content_ids?: string[];
  content_name?: string;
}

export interface CapiEvent {
  event_name: CapiEventName;
  event_time?: number;
  event_id: string;
  action_source: ActionSource;
  event_source_url?: string;
  user_data: CapiUserData;
  custom_data?: CapiCustomData;
}

export interface CapiSendInput {
  events: CapiEvent[];
  test_event_code?: string;
}

export interface CapiSendResult {
  events_received: number;
  fbtrace_id: string;
  messages: string[];
  test_event_code_used: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`required env var ${name} is not set`);
  return v;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeAndHash(value: string): string {
  return sha256(value.trim().toLowerCase());
}

function isAlreadyHashed(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function hashArray(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return values.map((v) => (isAlreadyHashed(v) ? v : normalizeAndHash(v)));
}

function hashUserData(user_data: CapiUserData): CapiUserData {
  return {
    ...user_data,
    em: hashArray(user_data.em),
    ph: hashArray(user_data.ph),
  };
}

/**
 * v1 safety net: if no test_event_code is supplied by the caller, inject
 * META_CAPI_TEST_EVENT_CODE from the environment. If THAT is also missing,
 * throw — never silently fire production conversion events. Production
 * CAPI is deferred to v1.5.
 */
function resolveTestEventCode(supplied?: string): string {
  if (supplied) return supplied;
  const fromEnv = process.env["META_CAPI_TEST_EVENT_CODE"];
  if (!fromEnv) {
    throw new Error(
      "v1 safety: META_CAPI_TEST_EVENT_CODE is not set and no test_event_code was supplied. " +
        "Refusing to send a non-test CAPI event. Production CAPI is deferred to v1.5.",
    );
  }
  return fromEnv;
}

export async function capiSend(input: CapiSendInput): Promise<CapiSendResult> {
  const pixelId = requireEnv("PIXEL_ID");
  const capiToken = requireEnv("CAPI_TOKEN");
  const testCode = resolveTestEventCode(input.test_event_code);

  const nowSec = Math.floor(Date.now() / 1000);
  const data = input.events.map((e) => ({
    ...e,
    event_time: e.event_time ?? nowSec,
    user_data: hashUserData(e.user_data),
  }));

  const url = new URL(`${META_GRAPH_BASE}/${pixelId}/events`);
  url.searchParams.set("access_token", capiToken);

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, test_event_code: testCode }),
  });

  const bodyText = await res.text();
  let body: {
    events_received?: number;
    fbtrace_id?: string;
    messages?: string[];
    error?: { message?: string };
  } = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    /* leave empty */
  }

  if (!res.ok) {
    const msg = body.error?.message ?? bodyText;
    throw new Error(`Meta CAPI ${res.status}: ${msg}`);
  }

  return {
    events_received: body.events_received ?? 0,
    fbtrace_id: body.fbtrace_id ?? "",
    messages: body.messages ?? [],
    test_event_code_used: testCode,
  };
}

export async function capiTestEvent(): Promise<{ ok: boolean; sample_response: CapiSendResult }> {
  const sample: CapiEvent = {
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `engineerdad_test_${Date.now()}`,
    action_source: "system_generated",
    user_data: {
      em: ["test@engineerdad.my"],
      ph: ["+60123456789"],
    },
    custom_data: {
      value: 0,
      currency: "MYR",
      content_name: "EngineerDad CAPI smoke test",
    },
  };
  const sample_response = await capiSend({ events: [sample] });
  return { ok: sample_response.events_received >= 1, sample_response };
}
