import { useEffect, useRef, useState } from 'react';
import type { Capsule } from '../types';
import { getCountdown } from '../utils/countdown.mjs';

type Props = {
  capsule: Capsule;
  onRefresh: (capsuleId: string | number) => Promise<Capsule | undefined>;
  onUpdated: (capsule: Capsule) => void;
  compact?: boolean;
};

export function CapsuleCountdown({ capsule, onRefresh, onUpdated, compact = false }: Props) {
  const [now, setNow] = useState(Date.now());
  const refreshRef = useRef(onRefresh);
  const updateRef = useRef(onUpdated);
  useEffect(() => { refreshRef.current = onRefresh; updateRef.current = onUpdated; }, [onRefresh, onUpdated]);
  const countdown = getCountdown(capsule.unlockAt, now);

  useEffect(() => {
    if (!capsule.sealed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [capsule.id, capsule.sealed]);

  useEffect(() => {
    if (!capsule.sealed || !countdown.valid || !countdown.expired) return;
    let active = true;
    const refresh = async () => {
      try {
        const updated = await refreshRef.current(capsule.id);
        if (active && updated) updateRef.current(updated);
      } catch { /* Keep the sealed state until the authoritative API confirms unlock. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [capsule.id, capsule.sealed, countdown.valid, countdown.expired]);

  if (!capsule.sealed) return <span className={`capsuleCountdown ${compact ? 'compact' : ''}`} role="status">Unlocked</span>;
  if (!countdown.valid) return <span className={`capsuleCountdown ${compact ? 'compact' : ''}`} role="status">Unlock time unavailable</span>;
  if (countdown.expired) return <span className={`capsuleCountdown ${compact ? 'compact' : ''}`} role="status">Unlock time reached · verifying</span>;
  const parts = [
    [countdown.days, 'd'], [countdown.hours, 'h'], [countdown.minutes, 'm'], [countdown.seconds, 's'],
  ] as const;
  return <span className={`capsuleCountdown ${compact ? 'compact' : ''}`} role="timer" aria-label={`${countdown.days} days, ${countdown.hours} hours, ${countdown.minutes} minutes, ${countdown.seconds} seconds until unlock`}>
    {parts.map(([value, unit]) => <span className="countdownPart" key={unit}><b>{compact ? String(value).padStart(2, '0') : value}</b><small>{unit}</small></span>)}
  </span>;
}
