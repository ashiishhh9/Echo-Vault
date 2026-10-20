import { useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight, Check, Download, Image, Lock, MessageCircle, Mic, Plus, Video } from 'lucide-react';
import type { ArchiveSettings, Capsule, Memory, MemoryKind, Page } from '../types';
import { PageHeader } from '../components/PageHeader';
import { CapsuleCountdown } from '../components/CapsuleCountdown';
import { archiveApi } from '../services/archiveApi';

const labels: Record<MemoryKind, string> = { written: 'Write a memory', photo: 'Add photos', voice: 'Record a voice note', video: 'Add a video' };
const coverColors: Capsule['color'][] = ['gold', 'blue', 'rose', 'rose'];
const toLocalDateTimeInput = (date: Date) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
};

type CreateProps = { navigate: (page: Page) => void; notify: (text: string) => void; onCreate: (input: Pick<Capsule, 'title' | 'color' | 'unlockDate'>, memories: Memory[]) => Promise<void> };

export function CreatePage({ navigate, notify, onCreate }: CreateProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('A note from this season');
  const [cover, setCover] = useState(0);
  const [date, setDate] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 5 * 60 * 1000)));
  const [items, setItems] = useState<Memory[]>([]);
  const [kind, setKind] = useState<MemoryKind | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const addMemoryItem = (next: Omit<Memory, 'id' | 'date' | 'mood'> & Partial<Pick<Memory, 'date' | 'mood'>>) => {
    const memory: Memory = {
      id: Date.now(),
      title: next.title,
      kind: next.kind,
      date: next.date ?? 'Sep 2026',
      mood: next.mood ?? 'Hopeful',
      mediaUrl: next.mediaUrl,
      fileName: next.fileName,
    };
    setItems((current) => [...current, memory]);
    setTitle('');
    setKind(null);
  };

  const add = () => {
    if (!kind || !title.trim()) return;
    addMemoryItem({ title: title.trim(), kind, fileName: title.trim() });
  };

  const handleMediaUpload = (selectedKind: MemoryKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const memoryTitle = selectedKind === 'photo' ? file.name || 'Photo memory' : 'Video memory';
      addMemoryItem({ title: memoryTitle, kind: selectedKind, mediaUrl: String(reader.result), fileName: file.name });
    };
    reader.onerror = () => notify(`Could not read ${file.name}. Please choose another file.`);
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const stopVoiceRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const clip = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const label = `Voice note ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const reader = new FileReader();
        reader.onload = () => addMemoryItem({ title: label, kind: 'voice', mediaUrl: String(reader.result), fileName: `${label}.webm` });
        reader.onerror = () => notify('Could not save this voice note. Please record it again.');
        reader.readAsDataURL(clip);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      notify('Microphone access is blocked. Please allow access to record a voice note.');
    }
  };

  const seal = async () => {
    if (!name.trim()) return notify('Please give your capsule a name.');
    if (!date) return notify('Please choose an unlock date.');
    setSaving(true);
    try {
      await onCreate({ title: name.trim(), color: coverColors[cover], unlockDate: new Date(date).toISOString() }, items);
      navigate('dashboard');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not save this capsule. Please try again.');
    } finally { setSaving(false); }
  };

  return <div className="create">
    <button className="back" onClick={() => navigate('dashboard')}>← Save & exit</button>
    <div className="progress" role="progressbar" aria-label="Capsule creation progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step}>{[1, 2, 3, 4].map((item) => <i key={item} className={item <= step ? 'done' : ''} />)}</div>
    <p className="overline">{String(step).padStart(2, '0')} / 04 — CREATE A CAPSULE</p>
    {step === 1 && <><h1>Give this chapter<br /><em>a name.</em></h1><p>Choose something that will make sense to the person you’ll become.</p><input aria-label="Capsule name" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></>}
    {step === 2 && <><h1>Set the <em>atmosphere.</em></h1><div className="coverChoices">{['Morning gold', 'Blue hour', 'Warm paper', 'Wild rose'].map((item, index) => <button className={`choice c${index}`} aria-pressed={cover === index} key={item} onClick={() => setCover(index)}>{cover === index && <Check />}<span>{item}</span></button>)}</div></>}
    {step === 3 && <><h1>What belongs<br /><em>inside?</em></h1><p>Add text notes, uploaded images/videos, or a quick voice memo for this capsule.</p><div className="addMemory">{([[MessageCircle, 'written'], [Image, 'photo'], [Mic, 'voice'], [Video, 'video']] as const).map(([Icon, memoryKind]) => <button key={memoryKind} onClick={() => {
      if (memoryKind === 'photo') { photoInputRef.current?.click(); return; }
      if (memoryKind === 'video') { videoInputRef.current?.click(); return; }
      if (memoryKind === 'voice') { if (isRecording) { stopVoiceRecording(); return; } void startVoiceRecording(); return; }
      setKind(memoryKind);
    }}><Icon />{memoryKind === 'voice' ? (isRecording ? 'Stop recording' : labels[memoryKind]) : labels[memoryKind]}<Plus /></button>)}</div><input ref={photoInputRef} hidden type="file" accept="image/*" onChange={(event) => handleMediaUpload('photo', event)} /><input ref={videoInputRef} hidden type="file" accept="video/*" onChange={(event) => handleMediaUpload('video', event)} />{kind && <div className="inlineEditor"><input autoFocus aria-label="Memory title" placeholder="Memory title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && add()} /><button className="gold" disabled={!title.trim()} onClick={add}>Add</button></div>}<div className="addedItems">{items.map((item) => <span key={item.id}>{item.title}<button aria-label={`Remove ${item.title}`} onClick={() => setItems((current) => current.filter((memory) => memory.id !== item.id))}>×</button></span>)}</div></>}
    {step === 4 && <><h1>Choose when<br />to <em>return.</em></h1><label className="dateInput">Unlock date and time<input type="datetime-local" min={toLocalDateTimeInput(new Date())} value={date} onChange={(event) => setDate(event.target.value)} /></label><p className="muted">For a quick test, choose a time a few minutes from now.</p></>}
    <div className="createFooter"><button className="quiet" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>Back</button><button className="gold" disabled={saving} onClick={() => step === 4 ? seal() : setStep((current) => current + 1)}>{step === 4 ? (saving ? 'Sealing…' : 'Seal capsule') : <>Continue <ArrowRight size={17} /></>}</button></div>
  </div>;
}

export function DetailPage({ navigate, capsule, memories = [], onRefreshCapsule, onCapsuleUpdated }: { navigate: (page: Page) => void; capsule?: Capsule; memories?: Memory[]; onRefreshCapsule: (capsuleId: string | number) => Promise<Capsule | undefined>; onCapsuleUpdated: (capsule: Capsule) => void }) {
  if (!capsule) return <div className="detail"><button className="back" onClick={() => navigate('dashboard')}>Back to your archive</button><p>No capsule selected.</p></div>;
  const memoryCards = <section className="memoryGrid">{memories.map((memory) => <article key={memory.id}>{memory.kind === 'photo' && memory.mediaUrl ? <div className="memVisual"><img src={memory.mediaUrl} alt={memory.fileName || memory.title} /></div> : memory.kind === 'video' && memory.mediaUrl ? <div className="memVisual"><video controls preload="metadata" src={memory.mediaUrl} /></div> : memory.kind === 'voice' && memory.mediaUrl ? <div className="memVisual"><audio controls preload="metadata" src={memory.mediaUrl} /></div> : null}<h3>{memory.title}</h3><small>{memory.kind.toUpperCase()} ? {memory.date}</small></article>)}{!memories.length && <p className="muted">This capsule is open. It does not contain any memories yet.</p>}</section>;
  if (capsule.sealed === false) return <div className="detail"><button className="back" onClick={() => navigate('dashboard')}>Back to your archive</button><div className="detailHero"><div className={`detailCover ${capsule.color}`}><span>?</span><p>UNLOCKED CAPSULE</p></div><div><p className="overline">UNLOCKED CAPSULE</p><h1>{capsule.title}</h1><p className="muted">{capsule.subtitle}</p><div className="meta"><span>Created <b>{capsule.createdAt}</b></span><span>Unlocked <b>{capsule.unlockDate}</b></span><span><b>{memories.length} memories</b></span></div></div></div>{memoryCards}</div>;
  return <div className="detail"><button className="back" onClick={() => navigate('dashboard')}>Back to your archive</button><div className="detailHero"><div className={`detailCover ${capsule.color}`}><span>?</span><p>SEALED CAPSULE</p></div><div><p className="overline">SEALED CAPSULE</p><h1>{capsule.title}</h1><p className="muted">{capsule.subtitle}</p><div className="meta"><span>Created <b>{capsule.createdAt}</b></span><span>Unlocks <b>{capsule.unlockDate}</b></span><span><b>{capsule.memories} memories</b></span></div></div></div><section className="locked"><Lock size={23} /><p className="overline">MEMORIES PROTECTED</p><h2>Your memories are sealed.</h2><p>They?re waiting exactly as you left them.</p><div className="unlockCountdown"><CapsuleCountdown capsule={capsule} onRefresh={onRefreshCapsule} onUpdated={onCapsuleUpdated} /></div><p className="muted">{capsule.memories} memories remain private until the server unlocks this capsule.</p></section></div>;
}

export function SettingsPage({ notify, settings, onSave }: { notify: (text: string) => void; settings: ArchiveSettings; onSave: (settings: ArchiveSettings) => Promise<void> }) {
  const [current, setCurrent] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const save = async (next: ArchiveSettings) => {
    const previous = current;
    setCurrent(next); setSaving(true); setSaveError('');
    try { await onSave(next); }
    catch (error) { setCurrent(previous); setSaveError(error instanceof Error ? error.message : 'Settings could not be saved. Try again.'); }
    finally { setSaving(false); }
  };
  const download = async () => { try { const data = await archiveApi.exportArchive(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'echovault-export.json'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000); notify('Archive export is ready.'); } catch (error) { notify(error instanceof Error ? error.message : 'Could not export your archive.'); } };
  return <div className="content settings"><PageHeader eyebrow="YOUR PRIVATE SPACE" title="Settings" description="Control how your archive works for you." /><div className="settingsPanel"><label><span><b>Notifications</b><small>Show capsule reminders in your archive.</small></span><input aria-label="In-app notifications" type="checkbox" disabled={saving} checked={current.notifications} onChange={(event) => save({ ...current, notifications: event.target.checked })} /></label><label><span><b>Unlock emails</b><small>Email me when one of my capsules is ready to open.</small></span><input aria-label="Unlock email notifications" type="checkbox" disabled={saving} checked={current.unlockEmails} onChange={(event) => save({ ...current, unlockEmails: event.target.checked })} /></label><label><span><b>Compact appearance</b><small>Use a denser archive layout.</small></span><input aria-label="Compact appearance" type="checkbox" disabled={saving} checked={current.compactMode} onChange={(event) => save({ ...current, compactMode: event.target.checked })} /></label>{saveError && <p className="formError" role="alert">{saveError}</p>}<button className="setting" disabled={saving} onClick={download}><div><h3>Data & export</h3><p>Download a copy of your account archive.</p></div><Download /></button></div></div>;
}
