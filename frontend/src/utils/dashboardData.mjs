export const UPCOMING_UNLOCK_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Count valid, still-sealed capsules unlocking between now and the window end. */
export function countUnlockingSoon(capsules, now = Date.now(), windowDays = UPCOMING_UNLOCK_WINDOW_DAYS) {
  const start = now instanceof Date ? now.getTime() : Number(now);
  const duration = Number(windowDays) * DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0) return 0;
  const end = start + duration;
  return capsules.reduce((count, capsule) => {
    if (capsule.sealed !== true) return count;
    const unlockTime = Date.parse(capsule.unlockAt ?? capsule.unlockDate);
    return Number.isFinite(unlockTime) && unlockTime >= start && unlockTime <= end ? count + 1 : count;
  }, 0);
}

/** Group API VADER scores by their UTC calendar date; same-day scores are averaged. */
export function groupMoodByDay(series) {
  const days = new Map();
  for (const observation of series) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.date) || !Number.isFinite(observation.value) || observation.value < 0 || observation.value > 100) continue;
    let day = days.get(observation.date);
    if (!day) {
      day = { sum: 0, count: 0, labels: new Map() };
      days.set(observation.date, day);
    }
    day.sum += observation.value;
    day.count += 1;
    if (observation.label) day.labels.set(observation.label, (day.labels.get(observation.label) ?? 0) + 1);
  }
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, day]) => ({
    date,
    value: Math.round((day.sum / day.count) * 10) / 10,
    observations: day.count,
    labels: [...day.labels.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([label]) => label),
  }));
}

export async function loadMoodSeries(fetchSummary) {
  try {
    const result = await fetchSummary();
    const series = groupMoodByDay(result.series ?? []);
    return { status: series.length ? 'ready' : 'empty', series };
  } catch (error) {
    return { status: 'error', series: [], error };
  }
}
