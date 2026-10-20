import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Mail, MapPin, Pencil, ShieldCheck, Sparkles } from 'lucide-react';
import type { Page, Profile } from '../types';
import { PageHeader } from '../components/PageHeader';

type ViewProps = { profile: Profile; capsules: number; memories: number; navigate: (page: Page) => void };

export function ProfilePage({ profile, capsules, memories, navigate }: ViewProps) {
  return <div className="content profilePage"><PageHeader eyebrow="YOUR IDENTITY" title="Profile" description="The person behind this archive." action={<button className="gold" onClick={() => navigate('edit-profile')}><Pencil size={16} />Edit profile</button>} /><section className="profileHero profileHeroView"><div className="profileAvatar profileAvatarLarge">{profile.initials}</div><div><p className="overline">PERSONAL ARCHIVE</p><h3>{profile.name || 'Your name'}</h3><p>{profile.bio || 'A short line about your archive.'}</p><div className="profileMeta"><span><Mail size={13} />{profile.email}</span><span><MapPin size={13} />{profile.location || 'Location not added'}</span></div></div></section><div className="profileGrid"><section className="profileCard profileStatsCard"><p className="overline">YOUR COLLECTION</p><div className="profileStats"><span><b>{String(capsules).padStart(2, '0')}</b>capsules</span><span><b>{String(memories).padStart(2, '0')}</b>memories</span><span><b>{String(capsules).padStart(2, '0')}</b>chapters saved</span></div></section><section className="profileCard security"><ShieldCheck size={25} /><div><p className="overline">PRIVATE BY DESIGN</p><h3>Your archive is yours.</h3><p>Your capsules and memories are saved with your account and protected by ownership and unlock checks.</p></div></section></div><section className="profileTip"><Sparkles size={17} /><span>Tip: write a short bio that will feel meaningful to your future self.</span><button onClick={() => navigate('edit-profile')}>Update profile</button></section></div>;
}

type EditProps = { notify: (text: string) => void; profile: Profile; navigate: (page: Page) => void; onSave: (profile: Profile) => Promise<void> };

export function EditProfilePage({ notify, profile, navigate, onSave }: EditProps) {
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(profile), [profile]);
  const changed = JSON.stringify(draft) !== JSON.stringify(profile);
  const update = (field: keyof Profile, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const save = async () => {
    if (!draft.name.trim()) return notify('Please add your name before saving.');
    setSaving(true);
    const name = draft.name.trim();
    const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    try { await onSave({ ...draft, name, email: draft.email.trim(), initials }); navigate('profile'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save your profile. Please try again.'); }
    finally { setSaving(false); }
  };
  return <div className="content profilePage"><button className="back editBack" onClick={() => navigate('profile')}><ArrowLeft size={15} />Back to profile</button><PageHeader eyebrow="PERSONAL DETAILS" title="Edit profile" description="Make this archive feel like yours." action={<button className="gold" disabled={saving || !changed} onClick={save}><Check size={16} />{saving ? 'Saving…' : 'Save changes'}</button>} /><div className="editProfileGrid"><section className="profileCard editForm"><h3>About you</h3><p>These details are saved with your account.</p><label>Name<input autoFocus value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Your name" /></label><label>Email<input type="email" value={draft.email} onChange={(event) => update('email', event.target.value)} placeholder="you@example.com" /></label><label>Location<input value={draft.location} onChange={(event) => update('location', event.target.value)} placeholder="City, Country" /></label><label>Bio<textarea rows={5} value={draft.bio} onChange={(event) => update('bio', event.target.value)} placeholder="A few words for your future self" /></label></section><aside className="profilePreview"><p className="overline">LIVE PREVIEW</p><div className="profileAvatar profileAvatarLarge">{draft.name ? draft.name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() : 'EV'}</div><h3>{draft.name || 'Your name'}</h3><p>{draft.bio || 'Your story begins here.'}</p><small>{draft.location || 'Your location'} · Private archive</small></aside></div></div>;
}
