import type { Capsule } from '../types';
export const capsules: Capsule[] = [
  { id: 1, title: '2026 — Becoming Me', subtitle: 'A record of the in-between', createdAt: 'Sep 12, 2026', unlockDate: 'Sep 12, 2030', memories: 28, mood: 'Hopeful', color: 'gold' },
  { id: 2, title: 'Our First Trip', subtitle: 'Lisbon, under late afternoon light', createdAt: 'Jul 04, 2026', unlockDate: 'Jul 04, 2028', memories: 46, mood: 'Joyful', color: 'blue' },
  { id: 3, title: 'First Year of College', subtitle: 'The beginning of everything', createdAt: 'May 29, 2025', unlockDate: 'May 29, 2029', memories: 63, mood: 'Reflective', color: 'rose' },
];
export const moodData = [38, 52, 44, 62, 56, 73, 68, 86].map((value) => ({ value }));
export const memoryTitles = ['A small promise to myself', 'The street after rain', 'Things I want to remember', 'A voice from home', 'Six ordinary, perfect minutes', 'Notes from the train'];
