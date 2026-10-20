import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import type { Page } from '../types';
import { Brand } from '../components/Brand';

type Props = { mode: 'login' | 'register'; navigate: (page: Page) => void; onComplete: (mode: 'login' | 'register', name: string, email: string, password: string) => Promise<void> };

export function AuthPage({ mode, navigate, onComplete }: Props) {
  const registering = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password.trim() || registering && !name.trim()) { setFormError('Please complete each field to continue.'); return; }
    if (password.trim().length < 6) { setFormError('Use at least 6 characters for the demo password.'); return; }
    setFormError('');
    setSubmitting(true);
    try { await onComplete(mode, name.trim(), email.trim(), password); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Could not sign in. Please try again.'); }
    finally { setSubmitting(false); }
  };

  return <main className="authPage">
    <button className="authBack" onClick={() => navigate('home')}><ArrowLeft size={16} />Back to home</button>
    <section className="authPanel">
      <Brand />
      <div className="authAccent"><Sparkles size={18} /></div>
      <p className="overline">{registering ? 'BEGIN YOUR ARCHIVE' : 'WELCOME BACK'}</p>
      <h1>{registering ? <>A place for<br /><em>your story.</em></> : <>Return to<br /><em>your archive.</em></>}</h1>
      <p className="authLead">{registering ? 'Create an account for your private collection of moments.' : 'Sign in to continue to your private collection of moments.'}</p>
      <form onSubmit={submit}>
        {registering && <label>Your name<input autoFocus autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" /></label>}
        <label>Email address<span className="inputIcon"><Mail size={16} /><input autoFocus={!registering} autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></span></label>
        <label>Password<span className="inputIcon"><LockKeyhole size={16} /><input autoComplete={registering ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        {!registering && <button type="button" className="forgot" onClick={() => setFormError('Password recovery will be available when the backend is connected.')}>Forgot password?</button>}
        {formError && <p className="formError" role="alert">{formError}</p>}
        <button className="gold authSubmit" disabled={submitting}>{submitting ? 'Opening archive…' : registering ? 'Create my archive' : 'Sign in'} <ArrowRight size={17} /></button>
      </form>
      <p className="authSwitch">{registering ? 'Already have an archive?' : 'New to Echovault?'} <button onClick={() => navigate(registering ? 'login' : 'register')}>{registering ? 'Sign in' : 'Create an account'}</button></p>
    </section>
    <aside className="authVisual"><div className="authGlow" /><p className="overline">PRIVATE BY DESIGN</p><h2>Keep the original<br />version of <em>you.</em></h2><div className="authQuote">“Small moments become landmarks when we give them somewhere to stay.”<small>ECHOVAULT FIELD NOTE</small></div></aside>
  </main>;
}
