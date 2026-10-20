import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ToastMessage } from '../types';
export function Toast({ message }: { message: ToastMessage }) { return <AnimatePresence>{message && <motion.div className="toast" role="status" aria-live="polite" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}><Check size={16} />{message.text}</motion.div>}</AnimatePresence>; }
