import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { Capsule } from '../types';
import { CapsuleCountdown } from './CapsuleCountdown';

type Props = {
  capsule: Capsule;
  onOpen: (capsule: Capsule) => void;
  onEdit: (capsule: Capsule) => void;
  onDelete: (capsule: Capsule) => void;
  onRefresh: (capsuleId: string | number) => Promise<Capsule | undefined>;
  onUpdated: (capsule: Capsule) => void;
};

export function CapsuleCard({ capsule, onOpen, onEdit, onDelete, onRefresh, onUpdated }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const glyph = capsule.color === 'gold' ? '✦' : capsule.color === 'blue' ? '⌁' : '◒';
  return <motion.article whileHover={{ y: -5 }} className={`capsule tone-${capsule.color}`}>
    <button type="button" className="capOpen" onClick={() => onOpen(capsule)} aria-label={`Open ${capsule.title}`}>
      <div className="cover"><span>{glyph}</span><small>{capsule.sealed ? 'SEALED' : 'UNLOCKED'}</small></div>
    </button>
    <div className="capInfo"><button type="button" className="capTitle" onClick={() => onOpen(capsule)}><p>{capsule.title}</p><small>{capsule.subtitle}</small></button><div className="capsuleActions">
      <button type="button" className="capsuleMenuButton" aria-label={`Actions for ${capsule.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={17} /></button>
      {menuOpen && <div className="capsuleMenu"><button type="button" onClick={() => { setMenuOpen(false); onEdit(capsule); }}><Pencil size={14} />Edit capsule</button><button type="button" className="deleteAction" onClick={() => { setMenuOpen(false); onDelete(capsule); }}><Trash2 size={14} />Delete capsule</button></div>}
    </div></div>
    <button type="button" className="capFoot" onClick={() => onOpen(capsule)}><span>{capsule.sealed ? <><Lock size={12} /> <CapsuleCountdown capsule={capsule} onRefresh={onRefresh} onUpdated={onUpdated} compact /></> : 'available now'}</span><b>{capsule.memories} memories</b></button>
  </motion.article>;
}
