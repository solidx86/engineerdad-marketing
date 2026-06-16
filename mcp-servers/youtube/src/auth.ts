/**
 * YouTube Data API auth (OAuth2 with a long-lived refresh token).
 *
 * One-time setup (see README):
 *   1. Enable YouTube Data API v3 in Google Cloud Console.
 *   2. Create OAuth client credentials (Desktop app type).
 *   3. Use OAuth Playground (or the gcloud CLI) with scope
 *      https://www.googleapis.com/auth/youtube to get a refresh_token.
 *   4. Put YOUTUBE_OAUTH_CLIENT_ID / SECRET / REFRESH_TOKEN in .env.
 *
 * Refresh tokens don't expire (unless explicitly revoked or unused for ~6 months
 * with a Testing-mode app). googleapis refreshes the short-lived access token
 * automatically before each call.
 */
import { google, type Auth } from "googleapis";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `required env var ${name} is not set. See mcp-servers/youtube/README.md for the OAuth Playground setup.`,
    );
  }
  return v;
}

let cachedClient: Auth.OAuth2Client | null = null;

export function getOAuthClient(): Auth.OAuth2Client {
  if (cachedClient) return cachedClient;
  const oauth2Client = new google.auth.OAuth2(
    requireEnv("YOUTUBE_OAUTH_CLIENT_ID"),
    requireEnv("YOUTUBE_OAUTH_CLIENT_SECRET"),
  );
  oauth2Client.setCredentials({
    refresh_token: requireEnv("YOUTUBE_OAUTH_REFRESH_TOKEN"),
  });
  cachedClient = oauth2Client;
  return oauth2Client;
}

export function getYouTubeClient() {
  return google.youtube({ version: "v3", auth: getOAuthClient() });
}

/** Test seam: lets unit tests reset the singleton so they can probe env-var validation. */
export function _resetAuthCacheForTests(): void {
  cachedClient = null;
}
