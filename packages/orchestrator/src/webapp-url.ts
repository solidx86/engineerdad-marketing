/**
 * Resolve the webapp's base URL (E-029). All HUMAN GATE messages embed a
 * link to the relevant entity list — derive it from WEBAPP_URL (new name)
 * or REVIEW_UI_URL (legacy fallback) so the orchestrator stays portable
 * when the UI moves off localhost:3030.
 */
let warnedReviewUiUrl = false;

export function webappUrl(): string {
  const fromOld = process.env.REVIEW_UI_URL;
  if (fromOld && !process.env.WEBAPP_URL && !warnedReviewUiUrl) {
    console.warn("REVIEW_UI_URL is deprecated; set WEBAPP_URL instead.");
    warnedReviewUiUrl = true;
  }
  return (process.env.WEBAPP_URL ?? fromOld ?? "http://localhost:3030").replace(/\/+$/, "");
}

/** @deprecated Use webappUrl(). Kept for transition; remove after 30 days. */
export function reviewUiUrl(): string {
  return webappUrl();
}
