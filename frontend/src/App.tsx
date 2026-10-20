import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import type { ArchiveNotification, ArchiveSettings, Capsule, Memory, Page, Profile, ToastMessage } from './types';
import { archiveApi } from './services/archiveApi';
import { AppShell } from './components/AppShell';
import { Toast } from './components/Toast';
import { HomePage } from './pages/HomePage';
import { AuthPage } from './pages/AuthPages';
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const CreatePage = lazy(() => import('./pages/ArchivePages').then((module) => ({ default: module.CreatePage })));
const DetailPage = lazy(() => import('./pages/ArchivePages').then((module) => ({ default: module.DetailPage })));
const SettingsPage = lazy(() => import('./pages/ArchivePages').then((module) => ({ default: module.SettingsPage })));
const ChatPage = lazy(() => import('./pages/AiPages').then((module) => ({ default: module.ChatPage })));
const ExplorePage = lazy(() => import('./pages/AiPages').then((module) => ({ default: module.ExplorePage })));
const InsightsPage = lazy(() => import('./pages/AiPages').then((module) => ({ default: module.InsightsPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const EditProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.EditProfilePage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));

export default function App() {
  const [page, setPage] = useState<Page>(() => archiveApi.hasSession() ? 'dashboard' : 'home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage>(null);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState<ArchiveSettings | null>(null);
  const [notifications, setNotifications] = useState<ArchiveNotification[]>([]);
  const [selectedCapsule, setSelectedCapsule] = useState<Capsule | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<'loading' | 'ready' | 'error'>(() => archiveApi.hasSession() ? 'loading' : 'ready');
  const [archiveError, setArchiveError] = useState('');
  const [archiveSessionVersion, setArchiveSessionVersion] = useState(() => archiveApi.hasSession() ? 0 : -1);
  const archiveLoaded = useRef(false);
  const notify = (text: string) => { setToast({ text, id: Date.now() }); window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    if (archiveSessionVersion < 0 || !archiveApi.hasSession()) { archiveLoaded.current = false; return; }
    let cancelled = false;
    const refreshArchive = async (showLoading = false) => {
      if (!archiveApi.hasSession()) return;
      if (showLoading && !archiveLoaded.current) setArchiveStatus('loading');
      try {
        const result = await archiveApi.checkScheduledNotifications();
        if (cancelled) return;
        setCapsules(result.archive.capsules);
        setMemories(result.archive.memories);
        setProfile(result.archive.profile);
        setIsAdmin(result.archive.role === 'admin');
        setSettings(result.archive.settings);
        setNotifications(result.archive.notifications);
        setArchiveError('');
        setArchiveStatus('ready');
        archiveLoaded.current = true;
        result.due.forEach((item) => notify(`${item.title}: ${item.message}`));
      } catch (error) {
        if (cancelled) return;
        setCapsules([]); setMemories([]); setProfile(null); setSettings(null); setNotifications([]); setIsAdmin(false);
        archiveLoaded.current = false;
        setArchiveError(error instanceof Error ? error.message : 'Could not load your archive.');
        setArchiveStatus('error');
        if (!archiveApi.hasSession()) { setPage('home'); setArchiveSessionVersion(-1); notify(error instanceof Error && error.message === 'This account is disabled' ? 'This account is disabled. Contact support if you need access restored.' : 'Your session ended. Sign in again to continue.'); }
      }
    };

    if (!archiveLoaded.current) void refreshArchive(true);
    const timer = window.setInterval(() => void refreshArchive(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [archiveSessionVersion]);

  const openCapsule = (capsule: Capsule) => { setSelectedCapsule(capsule); setPage('detail'); };
  const applyCapsuleUpdate = (updated: Capsule) => {
    setCapsules((current) => current.map((capsule) => capsule.id === updated.id ? updated : capsule));
    setSelectedCapsule((current) => current?.id === updated.id ? updated : current);
  };
  const refreshCapsule = async (capsuleId: string | number) => {
    const updated = await archiveApi.getCapsule(capsuleId);
    applyCapsuleUpdate(updated);
    return updated;
  };
  const createCapsule = async (input: Pick<Capsule, 'title' | 'color' | 'unlockDate'>, newMemories: Memory[]) => {
    const created = await archiveApi.createCapsule(input, newMemories);
    setCapsules((current) => [created.capsule, ...current]);
    if (!created.capsule.sealed) setMemories((current) => [...created.memories, ...current]);
    setNotifications((current) => [created.notification, ...current]);
    notify('Capsule sealed and added to your archive.');
  };
  const updateCapsule = async (capsule: Capsule, title: string, description: string, unlockAt: string) => {
    const saved = await archiveApi.updateCapsule(capsule, title, description, unlockAt);
    setCapsules((current) => current.map((item) => item.id === saved.id ? saved : item));
    notify('Capsule updated.');
  };
  const deleteCapsule = async (capsule: Capsule) => {
    if (!window.confirm(`Delete “${capsule.title}” and all its memories? This cannot be undone.`)) return;
    try {
      await archiveApi.deleteCapsule(capsule);
      setCapsules((current) => current.filter((item) => item.id !== capsule.id));
      setMemories((current) => current.filter((memory) => memory.capsuleId !== capsule.id));
      notify('Capsule deleted.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not delete this capsule.');
    }
  };
  const retryArchive = () => setArchiveSessionVersion((current) => current + 1);
  const saveProfile = async (next: Profile) => { const saved = await archiveApi.updateProfile(next); setProfile(saved); notify('Profile saved.'); };
  const markNotificationsRead = async () => { try { const updated = await archiveApi.markNotificationsRead(); setNotifications(updated); notify('All notifications marked as read.'); } catch (error) { notify(error instanceof Error ? error.message : 'Could not update notifications. Please try again.'); } };
  const finishAuth = async (mode: 'login' | 'register', name: string, email: string, password: string) => {
    const archive = await archiveApi.authenticate(mode, name, email, password);
    setCapsules(archive.capsules); setMemories(archive.memories); setProfile(archive.profile); setSettings(archive.settings); setNotifications(archive.notifications); setIsAdmin(archive.role === 'admin');
    archiveLoaded.current = true; setArchiveError(''); setArchiveStatus('ready');
    setArchiveSessionVersion((current) => current < 0 ? 0 : current + 1);
    notify(mode === 'register' ? 'Your archive is ready.' : 'Welcome back to your archive.'); setPage('dashboard');
  };
  const logout = () => { void archiveApi.logout().catch(() => undefined); archiveLoaded.current = false; setArchiveSessionVersion(-1); setArchiveError(''); setArchiveStatus('ready'); setMenuOpen(false); setCapsules([]); setMemories([]); setProfile(null); setSettings(null); setNotifications([]); setIsAdmin(false); setPage('home'); notify('You have been logged out.'); };

  const pageContent = () => {
    if (page === 'admin') return isAdmin ? <AdminPage /> : <section className="adminPage"><div className="adminError" role="alert"><h2>Administrator access required</h2><p>This account does not have permission to view the admin dashboard.</p><button className="quiet" onClick={() => setPage('dashboard')}>Return to archive</button></div></section>;
    if (page === 'dashboard') return <DashboardPage navigate={setPage} notify={notify} capsules={capsules} openCapsule={openCapsule} memories={memories} onUpdateCapsule={updateCapsule} onDeleteCapsule={deleteCapsule} onRefreshCapsule={refreshCapsule} onCapsuleUpdated={applyCapsuleUpdate} archiveStatus={archiveStatus} archiveError={archiveError} onRetryArchive={retryArchive} />;
    if (page === 'create') return <CreatePage navigate={setPage} notify={notify} onCreate={createCapsule} />;
    if (page === 'detail') { const active = capsules.find((capsule) => capsule.id === selectedCapsule?.id) ?? selectedCapsule ?? capsules[0]; return <DetailPage navigate={setPage} capsule={active} memories={memories.filter((memory) => memory.capsuleId === active?.id)} onRefreshCapsule={refreshCapsule} onCapsuleUpdated={applyCapsuleUpdate} />; }
    const unlockedMemories = memories.filter((memory) => capsules.some((capsule) => capsule.id === memory.capsuleId && capsule.sealed === false));
    if (page === 'insights') return <InsightsPage memories={unlockedMemories} />;
    if (page === 'chat') return <ChatPage />;
    if (page === 'explore') return <ExplorePage memories={unlockedMemories} />;
    if (page === 'notifications') return <NotificationsPage notifications={notifications} onRead={markNotificationsRead} />;
    if (page === 'profile' && profile) return <ProfilePage profile={profile} capsules={capsules.length} memories={memories.length} navigate={setPage} />;
    if (page === 'edit-profile' && profile) return <EditProfilePage notify={notify} profile={profile} navigate={setPage} onSave={saveProfile} />;
    return settings ? <SettingsPage notify={notify} settings={settings} onSave={async (next) => { const saved = await archiveApi.updateSettings(next); setSettings(saved); notify('Settings saved.'); }} /> : null;
  };

  return <MotionConfig reducedMotion="user"><AnimatePresence mode="wait"><motion.main key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28 }}>{page === 'home' ? <HomePage navigate={setPage} /> : page === 'login' || page === 'register' ? <AuthPage mode={page} navigate={setPage} onComplete={finishAuth} /> : <AppShell page={page} navigate={setPage} menuOpen={menuOpen} setMenuOpen={setMenuOpen} onLogout={logout} notify={notify} compactMode={settings?.compactMode ?? false} profile={profile} unreadNotifications={notifications.filter((item) => !item.read).length} isAdmin={isAdmin}><Suspense fallback={<div className="routeLoading" role="status">Loading this page…</div>}>{pageContent()}</Suspense></AppShell>}</motion.main></AnimatePresence><Toast message={toast} /></MotionConfig>;
}
