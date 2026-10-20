export type CapsuleUnlockState = { sealed?: boolean; unlockAt?: string; unlockDate: string };
export type MoodObservation = { date: string; value: number; label?: string };
export type DailyMoodPoint = { date: string; value: number; observations: number; labels: string[] };
export type MoodLoadResult = { status: 'ready' | 'empty'; series: DailyMoodPoint[] } | { status: 'error'; series: []; error: unknown };
export const UPCOMING_UNLOCK_WINDOW_DAYS: 30;
export function countUnlockingSoon(capsules: readonly CapsuleUnlockState[], now?: number | Date, windowDays?: number): number;
export function groupMoodByDay(series: readonly MoodObservation[]): DailyMoodPoint[];
export function loadMoodSeries(fetchSummary: () => Promise<{ series?: readonly MoodObservation[] }>): Promise<MoodLoadResult>;
