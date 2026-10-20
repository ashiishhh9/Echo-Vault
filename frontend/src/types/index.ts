export type Page = 'home' | 'login' | 'register' | 'dashboard' | 'create' | 'detail' | 'insights' | 'chat' | 'explore' | 'settings' | 'profile' | 'edit-profile' | 'notifications' | 'admin';
export type Capsule = { id: number | string; title: string; subtitle: string; createdAt: string; unlockDate: string; unlockAt?: string; memories: number; mood: string; color: 'gold' | 'blue' | 'rose'; sealed?: boolean };
export type MemoryKind = 'written' | 'photo' | 'voice' | 'video';
export type Memory = {
    id: number | string;
    title: string;
    kind: MemoryKind;
    date: string;
    mood: string;
    capsuleId?: number | string;
    mediaUrl?: string;
    fileName?: string;
    mediaMimeType?: string;
};
export type Profile = { name: string; email: string; location: string; bio: string; initials: string };
export type ArchiveSettings = { notifications: boolean; unlockEmails: boolean; compactMode: boolean; exportFormat: 'json' | 'text' };
export type ArchiveNotification = { id: number | string; title: string; message: string; time: string; kind: 'capsule' | 'memory' | 'system'; read: boolean };
export type ToastMessage = { text: string; id: number } | null;
