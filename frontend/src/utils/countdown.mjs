export function getCountdown(unlockAt, now = Date.now()) {
  const timestamp = typeof unlockAt === 'number' ? unlockAt : Date.parse(unlockAt ?? '');
  if (!Number.isFinite(timestamp)) return { valid: false, expired: false, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const remaining = Math.max(0, Math.ceil((timestamp - now) / 1000));
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;
  return { valid: true, expired: remaining === 0, days, hours, minutes, seconds };
}
