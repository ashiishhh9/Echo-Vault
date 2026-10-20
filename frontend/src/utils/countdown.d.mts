export type CountdownValue = { valid: boolean; expired: boolean; days: number; hours: number; minutes: number; seconds: number };
export function getCountdown(unlockAt: string | number | undefined, now?: number): CountdownValue;
