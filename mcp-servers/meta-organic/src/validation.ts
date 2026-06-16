const MIN_LEAD_SECONDS = 10 * 60; // 10 min
const MAX_LEAD_SECONDS = 75 * 24 * 60 * 60; // 75 days (Meta hard cap)

export function validateScheduledPublishTime(
  scheduledAtUnix: number,
  nowUnix: number = Math.floor(Date.now() / 1000)
): void {
  const lead = scheduledAtUnix - nowUnix;
  if (lead < MIN_LEAD_SECONDS) {
    throw new Error(
      `immediate_publish_disabled: scheduled_publish_time must be ≥ now+10min (got lead=${lead}s)`
    );
  }
  if (lead > MAX_LEAD_SECONDS) {
    throw new Error(
      `out_of_schedule_window: scheduled_publish_time must be ≤ now+75d (got lead=${lead}s)`
    );
  }
}
