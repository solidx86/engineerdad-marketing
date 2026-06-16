# Meta Credentials Setup Guide

Step-by-step guide for filling in the Meta-related variables in `.env`:

```
META_TOKEN=
AD_ACCOUNT_ID=
PIXEL_ID=
CAPI_TOKEN=
META_CAPI_TEST_EVENT_CODE=
```

---

## 1. `META_TOKEN` — Marketing API access token

Used for reading ad account insights (separate from CAPI token).

1. Go to https://developers.facebook.com/apps → **Create App** → type **Business**.
2. In the app dashboard, add **Marketing API** as a product.
3. Open **Marketing API → Tools** → generate a token with these scopes: `ads_read`, `ads_management`, `business_management`.
4. That short-lived token expires in ~2 hours. To get a **long-lived (60-day) token**, exchange it:
   ```
   https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN
   ```
5. For a **never-expiring System User token** (recommended for production): Business Manager → **Business Settings → Users → System Users → Add → Generate Token** with the same scopes. Assign the system user to your ad account and pixel.

## 2. `AD_ACCOUNT_ID`

1. Go to https://adsmanager.facebook.com → top-left account picker → copy the numeric ID.
2. **Format it with the `act_` prefix**: `act_1234567890`. The Marketing API requires that prefix.

## 3. `PIXEL_ID`

1. https://business.facebook.com → **Events Manager** → select your pixel.
2. Copy the **Dataset ID** shown at the top (long numeric string). That's your `PIXEL_ID`.
3. If you don't have one yet: Events Manager → **Connect Data Source → Web → Meta Pixel**.

## 4. `CAPI_TOKEN` — Conversions API access token

Distinct from `META_TOKEN`; scoped only to the pixel.

1. Events Manager → your pixel → **Settings** tab → scroll to **Conversions API**.
2. Click **Generate access token**. Copy it once — Meta won't show it again.

## 5. `META_CAPI_TEST_EVENT_CODE` — required safety net

The code at `mcp-servers/meta-ads/src/capi.ts:94-99` **refuses to send any CAPI event** unless this is set. v1 is test-mode-only by design.

1. Events Manager → your pixel → **Test Events** tab.
2. Copy the code shown (format: `TEST12345`).
3. Events fired with this code show up in the Test Events tab in real time and **do not** count as real conversions.

---

## Verify the setup

After filling `.env`, smoke-test CAPI:

```bash
cd mcp-servers/meta-ads
pnpm tsx -e "import('./src/capi.ts').then(m => m.capiTestEvent()).then(console.log)"
```

You should see `{ ok: true, ... }` and the event appear under Events Manager → Test Events within seconds.

---

## Notes

- `.env` is gitignored — never commit it.
- For `META_TOKEN`, prefer a System User token; user-tied tokens break when the user leaves the business.
- All five vars sit at the repo root `.env`; the meta-ads MCP loads from `process.env` directly.
- Production CAPI (without the test-event-code safety net) is deferred to v1.5.
