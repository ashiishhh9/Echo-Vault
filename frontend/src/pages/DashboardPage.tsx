import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowRight, Clock3, Image, Lock, Plus, Radio, RotateCw } from 'lucide-react';
import type { Capsule, Memory, Page } from '../types';
import { CapsuleCard } from '../components/CapsuleCard';
import { PageHeader } from '../components/PageHeader';
import { archiveApi } from '../services/archiveApi';
import { countUnlockingSoon, groupMoodByDay, loadMoodSeries, UPCOMING_UNLOCK_WINDOW_DAYS } from '../utils/dashboardData.mjs';

const MoodChart = lazy(() => import('./MoodChart').then((module) => ({ default: module.MoodChart })));

function Stat({ value, label, Icon }: { value: string; label: string; Icon: typeof Archive }) {
  return <div className="stat"><span><Icon size={17} /></span><b>{value}</b><p>{label}</p></div>;
}

function LiveActivity({ capsules, memories }: { capsules: Capsule[]; memories: Memory[] }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <section className="liveActivity"><div className="liveIndicator"><Radio size={15} /><span>LIVE ARCHIVE</span></div><p><b>{memories.length}</b> memories safely held across <b>{capsules.length}</b> capsules</p><time>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><div className="liveBars"><i /><i /><i /><i /><i /></div></section>;
}

type MoodPoint = ReturnType<typeof groupMoodByDay>[number];

const localDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function CapsuleEditor({ capsule, onCancel, onSave }: { capsule: Capsule; onCancel: () => void; onSave: (capsule: Capsule, title: string, description: string, unlockAt: string) => Promise<void> }) {
  const editorRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(capsule.title);
  const [description, setDescription] = useState(capsule.subtitle);
  const exactUnlockAt = capsule.unlockAt ?? capsule.unlockDate;
  const roundedUnlockAt = capsule.sealed ? new Date(Math.ceil(Date.parse(exactUnlockAt) / 60_000) * 60_000).toISOString() : exactUnlockAt;
  const [unlockAt, setUnlockAt] = useState(localDateTime(roundedUnlockAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    editorRef.current?.showModal();
    return () => { if (editorRef.current?.open) editorRef.current.close(); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try { await onSave(capsule, title.trim(), description, new Date(unlockAt).toISOString()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this capsule.'); }
    finally { setSaving(false); }
  };
  const minUnlock = capsule.sealed ? localDateTime(roundedUnlockAt) : undefined;
  return <dialog ref={editorRef} className="capsuleEditor" aria-labelledby="capsule-editor-title" onCancel={(event) => { event.preventDefault(); onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <p className="overline">YOUR ARCHIVE</p><h2 id="capsule-editor-title">Edit capsule</h2>
      <form onSubmit={submit}>
        <label>Capsule name<input autoFocus maxLength={200} required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Description<textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
        <label>Unlock date and time<input type="datetime-local" required min={minUnlock} value={unlockAt} onChange={(event) => { setUnlockAt(event.target.value); setError(''); }} /></label>
        {capsule.sealed && <small className="muted">A sealed capsule can be moved later, but not to an earlier date.</small>}
        {error && <p className="formError" role="alert">{error}</p>}
        <div className="dialogActions"><button type="button" className="quiet" onClick={onCancel}>Cancel</button><button className="gold" disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </form>
  </dialog>;
}

export function DashboardPage({ navigate, notify, capsules, memories, openCapsule, onUpdateCapsule, onDeleteCapsule, onRefreshCapsule, onCapsuleUpdated, archiveStatus, archiveError, onRetryArchive }: { navigate: (page: Page) => void; notify: (text: string) => void; capsules: Capsule[]; memories: Memory[]; openCapsule: (capsule: Capsule) => void; onUpdateCapsule: (capsule: Capsule, title: string, description: string, unlockAt: string) => Promise<void>; onDeleteCapsule: (capsule: Capsule) => Promise<void>; onRefreshCapsule: (capsuleId: string | number) => Promise<Capsule | undefined>; onCapsuleUpdated: (capsule: Capsule) => void; archiveStatus: 'loading' | 'ready' | 'error'; archiveError: string; onRetryArchive: () => void }) {
  const [moodSeries, setMoodSeries] = useState<MoodPoint[]>([]);
  const [moodStatus, setMoodStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [moodRetry, setMoodRetry] = useState(0);
  const [editingCapsule, setEditingCapsule] = useState<Capsule | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (archiveStatus !== 'ready') {
      setMoodSeries([]);
      setMoodStatus('idle');
      return () => { cancelled = true; };
    }
    setMoodStatus('loading');
    void loadMoodSeries(() => archiveApi.getMoodSummary()).then((result) => {
      if (cancelled) return;
      setMoodSeries(result.series);
      setMoodStatus(result.status);
    });
    return () => { cancelled = true; };
  }, [archiveStatus, memories.length, moodRetry]);

  const now = Date.now();
  const timestamp = (capsule: Capsule) => Date.parse(capsule.unlockAt ?? capsule.unlockDate);
  const lockedCapsules = capsules.filter((capsule) => capsule.sealed);
  const next = lockedCapsules.filter((capsule) => Number.isFinite(timestamp(capsule)) && timestamp(capsule) > now).slice().sort((left, right) => timestamp(left) - timestamp(right))[0];
  const unlockingSoon = countUnlockingSoon(capsules, now);

  return <div className="content">
    <PageHeader eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()} title="Your memories" description="Small moments, carefully kept." action={<button className="gold" onClick={() => navigate('create')}><Plus size={17} />New capsule</button>} />
    <div className="stats">
      <Stat value={archiveStatus === 'ready' ? String(capsules.length).padStart(2, '0') : '—'} label="Total capsules" Icon={Archive} />
      <Stat value={archiveStatus === 'ready' ? String(lockedCapsules.length).padStart(2, '0') : '—'} label="Sealed safely" Icon={Lock} />
      <Stat value={archiveStatus === 'ready' ? String(unlockingSoon).padStart(2, '0') : '—'} label={`Unlocking in ${UPCOMING_UNLOCK_WINDOW_DAYS} days`} Icon={Clock3} />
      <Stat value={archiveStatus === 'ready' ? String(memories.length) : '—'} label="Memories captured" Icon={Image} />
    </div>
    {archiveStatus === 'loading' && <p className="muted" role="status">Loading your archive…</p>}
    {archiveStatus === 'error' && <div className="dashboardError" role="alert"><p>{archiveError || 'Could not load your archive.'}</p><button className="link" onClick={onRetryArchive}><RotateCw size={14} />Try again</button></div>}
    {archiveStatus === 'ready' && <>
    <LiveActivity capsules={capsules} memories={memories} />
    <section className="sectionHead"><div><h3>Along your timeline</h3><p>Capsules waiting across your life.</p></div><button className="link" onClick={() => navigate('explore')}>View all <ArrowRight size={15} /></button></section>
    {capsules.length > 0 ? <div className="capsules">{capsules.map((capsule) => <CapsuleCard key={capsule.id} capsule={capsule} onOpen={openCapsule} onEdit={setEditingCapsule} onDelete={(item) => void onDeleteCapsule(item)} onRefresh={onRefreshCapsule} onUpdated={onCapsuleUpdated} />)}</div> : <p className="muted">No capsules yet. Create your first time capsule to begin.</p>}
    <div className="lower">
      <section className="journey">
        <div className="sectionHead"><div><h3>Emotional journey</h3><p>Daily average VADER mood score for unlocked text memories (0–100; 50 is neutral). This is a text signal, not a mental-health measure.</p></div><button className="round" aria-label="Retry mood analysis" onClick={() => setMoodRetry((current) => current + 1)}><RotateCw size={15} /></button></div>
        {moodStatus === 'loading' && <p className="muted" role="status">Analyzing unlocked text memories…</p>}
        {moodStatus === 'error' && <p className="muted" role="alert">Mood analysis is unavailable. Check that the AI service is running, then retry.</p>}
        {moodStatus === 'empty' && <p className="muted">No mood data yet. Unlock a capsule with text memories to see the daily trend.</p>}
        {moodStatus === 'ready' && <Suspense fallback={<p className="muted" role="status">Preparing mood chart…</p>}><MoodChart data={moodSeries} /></Suspense>}
      </section>
      <section className="unlock"><span className="spark">✦</span><p className="overline">NEXT REDISCOVERY</p><h3>{next?.title ?? 'Your next capsule'}</h3><p className="muted">{next ? `Unlocks ${next.unlockDate}` : 'No sealed capsules yet'}</p><div className="count"><b>{String(capsules.length).padStart(2, '0')}</b><b>{String(memories.length).padStart(2, '0')}</b></div>{next && <button className="link" onClick={() => openCapsule(next)}>View capsule <ArrowRight size={15} /></button>}</section>
    </div>
    </>}
    {editingCapsule && <CapsuleEditor capsule={editingCapsule} onCancel={() => setEditingCapsule(null)} onSave={async (capsule, title, description, unlockAt) => { await onUpdateCapsule(capsule, title, description, unlockAt); setEditingCapsule(null); }} />}
  </div>;
}
