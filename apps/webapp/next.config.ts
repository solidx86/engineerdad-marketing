import type { NextConfig } from "next";

// Server actions require the request's Origin host to be in allowedOrigins.
// Derive it from REVIEW_UI_URL so changing the deploy URL doesn't break form
// submissions silently.
const REVIEW_UI_URL = process.env.REVIEW_UI_URL ?? "http://localhost:3030";
const allowedOrigin = (() => {
  try {
    return new URL(REVIEW_UI_URL).host;
  } catch {
    return "localhost:3030";
  }
})();

const config: NextConfig = {
  experimental: {
    serverActions: { allowedOrigins: [allowedOrigin] },
  },
};

export default config;
