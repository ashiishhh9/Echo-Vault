import { ArrowRight, Lock, Sparkles } from 'lucide-react';
import type { Page } from '../types';
import { Brand } from '../components/Brand';

export function HomePage({ navigate }: { navigate: (page: Page) => void }) {
  return <div className="landing">
    <nav aria-label="Main">
      <Brand />
      <div className="navlinks"><a href="#how-it-works">How it works</a><a href="#for-families">For families</a><a href="#privacy">Privacy</a></div>
      <div><button className="quiet" onClick={() => navigate('login')}>Sign in</button><button className="small gold" onClick={() => navigate('register')}>Begin your archive</button></div>
    </nav>
    <section className="hero">
      <div className="eyebrow"><span /> PRESERVE WHAT MATTERS</div><h1>Some memories<br />are meant <em>for later.</em></h1><p>Capture who you are today. Seal it. Come back to yourself in the future.</p>
      <div className="heroActions"><button className="gold" onClick={() => navigate('register')}>Create a time capsule <ArrowRight size={17} /></button><button className="play" onClick={() => navigate('login')}>Explore the experience <span>→</span></button></div>
      <div className="orbit"><div className="orbital line" /><div className="memory one">“You were braver than you knew.”<small>Letter · Sep 2026</small></div><div className="memory two"><div className="mini-photo" />Lisbon, 7:42pm<small>Photo · Jul 2026</small></div><div className="capsuleHero"><div className="capTop" /><Lock size={34} /><b>2026</b><small>sealed until 2030</small></div><div className="memory three">A voice I never want to forget<small>Voice note · 01:24</small></div></div>
    </section>
    <section className="numbers">{[['12.4K', 'memories preserved'], ['3.8K', 'capsules sealed'], ['94%', 'return for an unlock'], ['87%', 'create another capsule']].map(([value, label]) => <div key={label}><b>{value}</b><span>{label}<sup>demo</sup></span></div>)}</section>
    <section className="intro" id="how-it-works"><p className="eyebrow">AN ARCHIVE FOR A LIFE IN MOTION</p><h2>Time changes the story.<br /><em>Keep the original.</em></h2><p className="lead">Echovault is a private space for the pieces of life that deserve more than a camera roll. Collect them with intention, then choose the moment they return.</p><div className="featureGrid">{[['01', 'Collect honestly', 'Words, photographs, videos, and voices—held together in a place made for remembering.'], ['02', 'Seal with purpose', 'Set a date or a life moment. Your memories remain entirely yours until then.'], ['03', 'Rediscover deeply', 'Let a new perspective reveal the thread between who you were and who you became.']].map(([number, title, body]) => <div className="feature" key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p><a href="#privacy">Discover more <ArrowRight size={14} /></a></div>)}</div></section>
    <section className="familyNote" id="for-families"><p className="eyebrow">FOR THE PEOPLE YOU LOVE</p><h2>Keep a chapter close,<br /><em>even from far away.</em></h2><p>Use a capsule to preserve the stories, encouragement, and ordinary details that deserve a place beyond a chat thread.</p></section>
    <section className="final" id="privacy"><Sparkles /><h2>Make room for a future<br />you will want to meet.</h2><p>Your archive is tied to your account. Capsule contents remain locked until their unlock date.</p><button className="gold" onClick={() => navigate('register')}>Start your first capsule <ArrowRight size={17} /></button></section>
    <footer>© 2026 ECHOVAULT <span>PRIVATE BY DESIGN · MADE FOR THE LONG VIEW</span></footer>
  </div>;
}
