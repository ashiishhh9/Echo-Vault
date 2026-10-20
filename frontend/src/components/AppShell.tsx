import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, Compass, LogOut, MessageCircle, Search, Settings, Sparkles, MoreHorizontal, UserRound, Shield, Menu } from 'lucide-react';
import type { Page, Profile } from '../types';
import { Brand } from './Brand';

const navItems: { page: Page; label: string; Icon: typeof Compass }[] = [
  { page: 'dashboard', label: 'Overview', Icon: Compass },
  { page: 'explore', label: 'Memory explorer', Icon: Search },
  { page: 'insights', label: 'AI insights', Icon: Sparkles },
  { page: 'chat', label: 'Past self', Icon: MessageCircle },
];
type Props = { page: Page; navigate: (page: Page) => void; menuOpen: boolean; setMenuOpen: (value: boolean) => void; onLogout: () => void; notify: (text: string) => void; compactMode: boolean; profile: Profile | null; unreadNotifications: number; isAdmin: boolean; children: ReactNode };

export function AppShell({ page, navigate, menuOpen, setMenuOpen, onLogout, notify, compactMode, profile, unreadNotifications, isAdmin, children }: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const nav = document.getElementById('primary-navigation');
    const focusable = () => [...(nav?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const handleNavigationKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuToggle.current?.focus(); }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
      }
    };
    window.addEventListener('keydown', handleNavigationKeys);
    return () => window.removeEventListener('keydown', handleNavigationKeys);
  }, [menuOpen, setMenuOpen]);
  const closeNavigation = () => { setMenuOpen(false); menuToggle.current?.focus(); };
  const go = (target: Page) => { navigate(target); setMenuOpen(false); setAccountOpen(false); if (window.matchMedia('(max-width: 900px)').matches) window.requestAnimationFrame(() => menuToggle.current?.focus()); };
  return <div className={`app${compactMode ? ' compact' : ''}`}>
    {menuOpen && <button className="mobileNavScrim" aria-label="Close navigation menu" onClick={closeNavigation} />}
    <aside id="primary-navigation" aria-label="Main navigation" className={menuOpen ? 'open' : ''}>
      <Brand />
      <div className="sideLabel">YOUR ARCHIVE</div>
      {navItems.map(({ page: target, label, Icon }) => <button className={page === target ? 'active' : ''} key={target} onClick={() => go(target)}><Icon size={18} />{label}</button>)}
      {isAdmin && <><div className="sideLabel adminNavLabel">ADMINISTRATION</div><button className={page === 'admin' ? 'active' : ''} onClick={() => go('admin')}><Shield size={18} />Admin dashboard</button></>}
      <div className="sideBottom">
        <button className={page === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings size={18} />Settings</button>
        <div className="accountBlock">
          <button className="profileMain" onClick={() => go('profile')}><div className="sideAvatar">{profile?.initials ?? 'DS'}</div><span>{profile?.name ?? 'Your archive'}<small>Personal archive</small></span></button>
          <button className="profileMore" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((current) => !current)}><MoreHorizontal size={18} /></button>
          {accountOpen && <div className="accountMenu"><button onClick={() => go('profile')}><UserRound size={15} />View profile</button><button onClick={onLogout}><LogOut size={15} />Log out</button></div>}
        </div>
      </div>
    </aside>
    <div className="main"><header><button ref={menuToggle} type="button" className="mobileMenu" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button><div className="crumb">Archive <b>/ {page === 'dashboard' ? 'Overview' : page === 'admin' ? 'Admin dashboard' : page.replace('-', ' ')}</b></div><div className="topActions"><button className="notificationButton" aria-label="Open notifications" onClick={() => go('notifications')}><Bell size={18} />{unreadNotifications > 0 && <i className="notificationCount">{unreadNotifications}</i>}</button><button className="avatar" aria-label="View profile" onClick={() => go('profile')}>{profile?.initials ?? 'DS'}</button></div></header>{children}</div>
  </div>;
}
