import type { ArchiveNotification, ArchiveSettings, Capsule, Memory, MemoryKind, Profile } from '../types';

export type ArchiveState = {
  capsules: Capsule[];
  memories: Memory[];
  profile: Profile;
  settings: ArchiveSettings;
  notifications: ArchiveNotification[];
  role: 'user' | 'admin';
};

type ApiUser = { id: string; name: string; email: string; role?: 'user' | 'admin' };
type ApiCapsule = { id: string; title: string; description: string; created_at: string; unlock_at: string; status: string; memory_count?: number };
type ApiMemory = { id: string; capsule_id: string; type: string; content_text: string; media_url: string; media_filename?: string; created_at: string };
type ApiNotification = { id: string; type: string; message: string; created_at: string; read: boolean };
const API = import.meta.env.VITE_API_URL ?? '/api/v1';
const tokenKey = 'echovault-access-token';
const colorFor = (id: string): Capsule['color'] => ['gold', 'blue', 'rose'][[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3] as Capsule['color'];
const prettyDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const kindFor = (type: string): MemoryKind => ({ text: 'written', image: 'photo', audio: 'voice', video: 'video' }[type] as MemoryKind) ?? 'written';
const typeFor = (kind: MemoryKind) => ({ written: 'text', photo: 'image', voice: 'audio', video: 'video' })[kind];
const notificationKind = (type: string): ArchiveNotification['kind'] => type.includes('capsule') ? 'capsule' : type === 'memory' ? 'memory' : 'system';
const relativeTime = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return 'Yesterday';
  return `${Math.floor(seconds / 86400)}d ago`;
};
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) localStorage.removeItem(tokenKey);
    if (response.status === 403 && body.detail === 'This account is disabled') { localStorage.removeItem(tokenKey); clearPrivateMedia(); }
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};
const getToken = () => localStorage.getItem(tokenKey);
const mapProfile = (profile: ApiUser & { location?: string; bio?: string; initials?: string }): Profile => ({ name: profile.name, email: profile.email, location: profile.location ?? '', bio: profile.bio ?? '', initials: profile.initials ?? profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() });
const mediaBaseUrl = () => API.startsWith('http://') || API.startsWith('https://') ? API : window.location.origin;
const mediaUrlFor = (value: string) => value.startsWith('/api/v1/media/') ? new URL(value, mediaBaseUrl()).toString() : value;
const mapMemory = (memory: ApiMemory): Memory => ({ id: memory.id, capsuleId: memory.capsule_id, title: memory.content_text || memory.media_filename || 'Untitled memory', kind: kindFor(memory.type), date: prettyDate(memory.created_at), mood: 'Reflective', mediaUrl: memory.media_url ? mediaUrlFor(memory.media_url) : undefined, fileName: memory.media_filename });
const privateMediaCache = new Map<string, { promise: Promise<string | undefined> }>();
const privateMediaObjectUrls = new Set<string>();
const loadPrivateMedia = async (mediaPath: string) => {
  if (!mediaPath.startsWith('/api/v1/media/')) return undefined;
  let cached = privateMediaCache.get(mediaPath);
  if (!cached) {
    const token = localStorage.getItem(tokenKey);
    let promise: Promise<string | undefined>;
    promise = token ? fetch(new URL(mediaPath, mediaBaseUrl()), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => response.ok ? response.blob() : undefined)
      .then((blob) => {
        if (!blob || localStorage.getItem(tokenKey) !== token || privateMediaCache.get(mediaPath)?.promise !== promise) {
          if (privateMediaCache.get(mediaPath)?.promise === promise) privateMediaCache.delete(mediaPath);
          return undefined;
        }
        const objectUrl = URL.createObjectURL(blob);
        privateMediaObjectUrls.add(objectUrl);
        return objectUrl;
      })
      .catch(() => { if (privateMediaCache.get(mediaPath)?.promise === promise) privateMediaCache.delete(mediaPath); return undefined; }) : Promise.resolve(undefined);
    cached = { promise };
    privateMediaCache.set(mediaPath, cached);
    if (privateMediaCache.size > 200) {
      const oldest = privateMediaCache.entries().next().value;
      if (oldest) privateMediaCache.delete(oldest[0]);
    }
  }
  return cached.promise;
};
const mapMemoryWithMedia = async (raw: ApiMemory): Promise<Memory> => {
  const memory = mapMemory(raw);
  if (!raw.media_url.startsWith('/api/v1/media/')) return memory;
  memory.mediaUrl = await loadPrivateMedia(raw.media_url);
  return memory;
};
const clearPrivateMedia = () => {
  privateMediaCache.clear();
  for (const objectUrl of privateMediaObjectUrls) URL.revokeObjectURL(objectUrl);
  privateMediaObjectUrls.clear();
};
const blobUrlAsDataUrl = async (url: string) => {
  const blob = await fetch(url).then((response) => {
    if (!response.ok) throw new Error('Could not read a saved media file for export.');
    return response.blob();
  });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not encode a saved media file for export.'));
    reader.readAsDataURL(blob);
  });
};
const mapCapsule = (capsule: ApiCapsule): Capsule => ({ id: capsule.id, title: capsule.title, subtitle: capsule.description || 'A record of this season', createdAt: prettyDate(capsule.created_at), unlockDate: prettyDate(capsule.unlock_at), unlockAt: capsule.unlock_at, memories: capsule.memory_count ?? 0, mood: 'Reflective', color: colorFor(capsule.id), sealed: capsule.status === 'LOCKED' });
const mapNotification = (item: ApiNotification): ArchiveNotification => ({ id: item.id, title: item.type === 'capsule_unlocked' ? 'Your capsule is ready' : item.type === 'capsule_sealed' ? 'Capsule sealed' : 'Archive update', message: item.message, time: relativeTime(item.created_at), kind: notificationKind(item.type), read: item.read });

export const archiveApi = {
  async authenticate(mode: 'login' | 'register', name: string, email: string, password: string) {
    if (mode === 'register') await request<ApiUser>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    const result = await request<{ access_token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    clearPrivateMedia();
    localStorage.setItem(tokenKey, result.access_token);
    return this.getArchive();
  },
  async logout() {
    try { if (getToken()) await request('/auth/logout', { method: 'POST' }); }
    finally { localStorage.removeItem(tokenKey); clearPrivateMedia(); }
  },
  async getArchive(): Promise<ArchiveState> {
    const [user, profile, settings, rawCapsules, rawNotifications] = await Promise.all([
      request<ApiUser>('/auth/me'), request<ApiUser & { location: string; bio: string; initials: string }>('/profile'), request<{ notifications: boolean; unlock_emails: boolean; compact_mode: boolean; export_format: 'json' | 'text' }>('/settings'), request<ApiCapsule[]>('/capsules'), request<ApiNotification[]>('/notifications'),
    ]);
    const perCapsule = await Promise.all(rawCapsules.map(async (capsule) => capsule.status === 'LOCKED' ? [] : request<ApiMemory[]>(`/capsules/${capsule.id}/memories`)));
    const allMemories = perCapsule.flat();
    const capsules = rawCapsules.map((capsule) => ({ ...mapCapsule({ ...capsule, memory_count: capsule.memory_count ?? perCapsule[rawCapsules.indexOf(capsule)].length }), memories: capsule.memory_count ?? perCapsule[rawCapsules.indexOf(capsule)].length }));
    return { capsules, memories: await Promise.all(allMemories.map(mapMemoryWithMedia)), profile: mapProfile({ ...user, ...profile }), settings: { notifications: settings.notifications, unlockEmails: settings.unlock_emails, compactMode: settings.compact_mode, exportFormat: settings.export_format }, notifications: rawNotifications.map(mapNotification), role: user.role ?? 'user' };
  },
  async checkScheduledNotifications() {
    const archive = await this.getArchive();
    return { archive, due: [] as ArchiveNotification[] };
  },
  async createCapsule(input: Pick<Capsule, 'title' | 'color' | 'unlockDate'>, memories: Memory[]) {
    const raw = await request<ApiCapsule>('/capsules', { method: 'POST', body: JSON.stringify({ title: input.title, description: 'A record of this season', unlock_at: new Date(input.unlockDate).toISOString() }) });
    const savedMemories: Memory[] = [];
    try {
      for (const memory of memories) {
        const result = await request<ApiMemory>(`/capsules/${raw.id}/memories`, { method: 'POST', body: JSON.stringify({ type: typeFor(memory.kind), content_text: memory.title, media_url: memory.mediaUrl ?? '', file_name: memory.fileName ?? '' }) });
        savedMemories.push(await mapMemoryWithMedia(result));
      }
    } catch (error) {
      await request(`/capsules/${raw.id}`, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
    const capsule = { ...mapCapsule({ ...raw, memory_count: savedMemories.length }), color: input.color, memories: savedMemories.length };
    const storedNotifications = await request<ApiNotification[]>('/notifications');
    const stored = storedNotifications.find((item) => item.type.startsWith('capsule_') && item.message.includes(capsule.title));
    const notification: ArchiveNotification = stored ? mapNotification(stored) : { id: Date.now(), title: 'Capsule sealed', message: `${capsule.title} was added to your private archive.`, time: 'Just now', kind: 'capsule', read: false };
    return { capsule, memories: savedMemories, notification };
  },
  async updateCapsule(capsule: Capsule, title: string, description: string, unlockAt: string) {
    const saved = await request<ApiCapsule>(`/capsules/${capsule.id}`, { method: 'PUT', body: JSON.stringify({ title, description, unlock_at: unlockAt }) });
    return { ...mapCapsule(saved), color: capsule.color, memories: capsule.memories };
  },
  async deleteCapsule(capsule: Capsule) {
    await request(`/capsules/${capsule.id}`, { method: 'DELETE' });
  },
  async updateProfile(profile: Profile) {
    const saved = await request<ApiUser & { location: string; bio: string; initials: string }>('/profile', { method: 'PUT', body: JSON.stringify({ name: profile.name, email: profile.email, location: profile.location, bio: profile.bio, initials: profile.initials }) });
    return mapProfile(saved);
  },
  async updateSettings(settings: ArchiveSettings) {
    const saved = await request<{ notifications: boolean; unlock_emails: boolean; compact_mode: boolean; export_format: 'json' | 'text' }>('/settings', { method: 'PATCH', body: JSON.stringify({ notifications: settings.notifications, unlock_emails: settings.unlockEmails, compact_mode: settings.compactMode, export_format: settings.exportFormat }) });
    return { notifications: saved.notifications, unlockEmails: saved.unlock_emails, compactMode: saved.compact_mode, exportFormat: saved.export_format };
  },
  async markNotificationsRead() {
    const archive = await this.getArchive();
    await Promise.all(archive.notifications.filter((item) => !item.read).map((item) => request(`/notifications/${item.id}/read`, { method: 'PATCH' })));
    return archive.notifications.map((item) => ({ ...item, read: true }));
  },
  async exportArchive() {
    const archive = await this.getArchive();
    const memories = await Promise.all(archive.memories.map(async (memory) => memory.mediaUrl?.startsWith('blob:') ? { ...memory, mediaUrl: await blobUrlAsDataUrl(memory.mediaUrl) } : memory));
    return { data: { ...archive, memories }, generatedAt: new Date().toISOString() };
  },
  async chatWithPast(query: string, conversationId?: string) { return request<{ answer: string; mode: string; grounded: boolean; context_limited?: boolean; conversation_id: string; user_message: { id: string; content: string; created_at: string }; assistant_message: { id: string; content: string; created_at: string }; references: { id: string; title: string; created_at?: string; similarity: number; media: { id: string; type: 'image' | 'video'; mime_type: string; media_url: string; filename: string }[] }[] }>('/ai/chat', { method: 'POST', body: JSON.stringify({ query, ...(conversationId ? { conversation_id: conversationId } : {}) }) }); },
  async getConversations() { return request<{ id: string; title: string; created_at: string; updated_at: string }[]>('/ai/conversations'); },
  async createConversation() { return request<{ id: string; title: string; created_at: string; updated_at: string }>('/ai/conversations', { method: 'POST', body: JSON.stringify({}) }); },
  async getConversation(id: string) { return request<{ id: string; title: string; messages: { id: string; role: 'user' | 'assistant'; content: string; created_at: string; references: { id: string; title: string; created_at?: string; similarity: number; media: { id: string; type: 'image' | 'video'; mime_type: string; media_url: string; filename: string }[] }[] }[] }>(`/ai/conversations/${encodeURIComponent(id)}`); },
  async deleteConversation(id: string) { await request(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  async loadPrivateMedia(mediaPath: string) { return loadPrivateMedia(mediaPath); },
  async getCapsule(id: string | number) { const raw = await request<ApiCapsule>(`/capsules/${encodeURIComponent(String(id))}`); return mapCapsule(raw); },
  async searchMemories(query: string, limit = 10) { return request<{ query: string; model: string; dimensions: number; context_limited?: boolean; results: { id: string; text: string; created_at?: string; similarity: number }[] }>('/ai/search', { method: 'POST', body: JSON.stringify({ query, limit }) }); },
  async summarizeMemories(capsuleId?: number | string) { return request<{ summary: string; method: string; memory_count: number; truncated?: boolean }>('/ai/summarize', { method: 'POST', body: JSON.stringify(capsuleId ? { capsule_id: capsuleId } : {}) }); },
  async analyzeMood(text: string) { return request<{ mood_score_0_100: number; label: string; compound_score: number }>('/ai/mood', { method: 'POST', body: JSON.stringify({ text }) }); },
  async getMoodSummary() { return request<{ count: number; average_mood_score: number | null; distribution: Record<string, number>; series: { date: string; value: number; label: string }[] }>('/ai/mood-summary'); },
  async getAdminOverview() { return request<AdminOverview>('/admin/overview'); },
  async getAdminUsers(search: string, page: number, limit = 20) { return request<AdminUserPage>(`/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`); },
  async setAdminUserStatus(id: string, status: 'active' | 'disabled') { return request<{ id: string; account_status: 'active' | 'disabled' }>(`/admin/users/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); },
  hasSession: getToken,
};

export type AdminOverview = {
  statistics: { total_users: number; active_users: number; disabled_users: number; admin_users: number; total_capsules: number; locked_capsules: number; unlocked_capsules: number; total_memories: number; upcoming_unlocks: number };
  recent_unlocks_7d: number;
  email_deliveries: Record<'pending' | 'sending' | 'accepted' | 'retry_scheduled' | 'permanently_failed' | 'disabled', number>;
  services: { node_api: string; ai_service: string; scheduler: string; scheduler_last_completed_at: string | null };
};
export type AdminUser = { id: string; name: string; email: string; created_at: string; role: 'user' | 'admin'; account_status: 'active' | 'disabled' };
export type AdminUserPage = { users: AdminUser[]; page: number; limit: number; total: number; pages: number };
