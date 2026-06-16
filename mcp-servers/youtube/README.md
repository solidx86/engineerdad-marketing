# @engineerdad/mcp-youtube

YouTube Data API v3 adapter for the Marketing OS distribution layer (Phase D).

## Tools

| Tool                     | Behavior                                                                                                              |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `upload_video`           | Upload bytes from `local_path`. **Hard-wired `privacyStatus: 'unlisted'`** — no caller override (ADR-015 doctrine). |
| `get_video_status`       | Read-only snippet + status + processing details + duration.                                                          |
| `update_video_metadata`  | Edit title / description / tags / category / language. **REFUSED if video is `public`** — human territory in Studio. |
| `upload_thumbnail`       | Replace thumbnail with a PNG/JPG from `local_path`.                                                                  |
| `delete_video`           | Permanent delete. Cleanup direction — always allowed.                                                                |

**No `set_public` / `update_privacy_status` exists.** Activation to `public` is a human-only step in YouTube Studio.

## Setup

### One-time OAuth setup

YouTube Data API requires OAuth2. You need three env vars in `.env` at repo root:

```
YOUTUBE_OAUTH_CLIENT_ID=...
YOUTUBE_OAUTH_CLIENT_SECRET=...
YOUTUBE_OAUTH_REFRESH_TOKEN=...
```

Steps:

1. **Enable YouTube Data API v3** in [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. **Create OAuth client credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Desktop app**
   - Note the client_id + client_secret.
3. **Get a refresh token via OAuth Playground**:
   - Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
   - Click the gear icon (top-right) → check "Use your own OAuth credentials" → paste your client_id + client_secret.
   - In "Step 1 — Select & authorize APIs", paste this scope into the input box:
     `https://www.googleapis.com/auth/youtube`
   - Click "Authorize APIs", complete the OAuth consent (sign in with the Google account whose YouTube channel you want to upload to), accept scopes.
   - In "Step 2 — Exchange authorization code for tokens", click "Exchange authorization code for tokens".
   - Copy the `refresh_token` from the response.
4. **Paste all three values into `.env` at repo root.**

Refresh tokens don't expire (unless explicitly revoked or unused for ~6 months while the OAuth app is in Testing mode). The MCP server refreshes the short-lived access token automatically before each call.

### Build + run

```sh
cd mcp-servers/youtube
pnpm install
pnpm build
pnpm start    # stdio MCP server
```

Registered in repo-root `.mcp.json` as the `youtube` server — Claude Code picks it up automatically.

## Safety contract (per ADR-015)

| What | Where the rule lives |
|---|---|
| Created videos always land `unlisted` | Hard-wired in `videos.ts` `uploadVideo()`; no field in MCP tool schema |
| No activation path | No `set_public` / `update_privacy_status` tool exists, anywhere |
| Public-video metadata edits | `updateVideoMetadata()` throws REFUSED if `privacyStatus === 'public'` |
| Public-video deletion | Allowed (cleanup direction; revoking publication is always safe) |

The agent calling these tools (typically `distribution`) cannot circumvent any of this by prompt injection — the safety lives in the MCP server's tool schema (no `privacy_status` field exists to pass `public` through) and the handler's guard (live-video metadata edit is refused).

## API quota note

YouTube Data API quota is **expensive on writes**: `videos.insert` costs 1600 units, `videos.update` costs 50, `videos.delete` costs 50. Default daily quota is 10,000 units → ~6 uploads/day before you hit the cap. Distribution agent should not retry failed uploads more than once per video.
