import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, ChevronLeft, ChevronRight, RefreshCw, Search, Shield, Users, LockKeyhole, Mail } from 'lucide-react';
import { archiveApi, type AdminOverview, type AdminUser, type AdminUserPage } from '../services/archiveApi';

const Metric = ({ label, value, note, icon: Icon }: { label: string; value: number | string; note?: string; icon: typeof Users }) => <article className="adminMetric"><span className="adminMetricIcon"><Icon size={17} /></span><small>{label}</small><strong>{value}</strong>{note && <span className="adminMetricNote">{note}</span>}</article>;
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserPage | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [stats, listing] = await Promise.all([archiveApi.getAdminOverview(), archiveApi.getAdminUsers(search, page)]);
      setOverview(stats); setUsers(listing);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load admin data.'); }
    finally { setLoading(false); }
  }, [search, page]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 220); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
    else if (!selected && dialogRef.current?.open) dialogRef.current.close();
  }, [selected]);

  const changeStatus = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      await archiveApi.setAdminUserStatus(selected.id, selected.account_status === 'active' ? 'disabled' : 'active');
      setSelected(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Account status could not be changed.'); }
    finally { setSaving(false); }
  };

  return <section className="adminPage">
    <div className="adminHeading"><div><p className="overline">CONTROL ROOM</p><h1>Admin dashboard</h1><p>Monitor platform activity and account health.</p></div><button className="adminRefresh" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />Refresh</button></div>
    {error && <div className="adminError" role="alert"><AlertTriangle size={18} /><div><b>Admin data could not be loaded</b><p>{error}</p></div><button onClick={() => void load()}>Retry</button></div>}
    {loading && !overview ? <div className="adminLoading" role="status">Loading platform metrics…</div> : <>
      {overview && <>
        <div className="adminMetrics">
          <Metric label="Registered users" value={overview.statistics.total_users} note={`${overview.statistics.active_users} active · ${overview.statistics.disabled_users} disabled`} icon={Users} />
          <Metric label="Capsules" value={overview.statistics.total_capsules} note={`${overview.statistics.locked_capsules} locked · ${overview.statistics.unlocked_capsules} unlocked`} icon={LockKeyhole} />
          <Metric label="Memories" value={overview.statistics.total_memories} note={`${overview.statistics.upcoming_unlocks} upcoming unlocks`} icon={Shield} />
          <Metric label="Unlocks · 7 days" value={overview.recent_unlocks_7d} note={`${overview.statistics.admin_users} administrators`} icon={Activity} />
        </div>
        <div className="adminPanel adminHealth"><div className="adminPanelHead"><div><h2>System health</h2><p>Live backend checks and persisted delivery counts.</p></div></div><div className="healthGrid">
          {([['Node API', overview.services.node_api], ['AI service', overview.services.ai_service], ['Unlock scheduler', overview.services.scheduler]] as const).map(([label, status]) => <div className="healthItem" key={label}><span className={`healthDot ${status === 'healthy' ? 'isHealthy' : status === 'unavailable' || status === 'starting' ? 'isUnknown' : 'isUnhealthy'}`} /><span>{label}</span><b>{status}</b>{label === 'Unlock scheduler' && overview.services.scheduler_last_completed_at && <small>Last run {new Date(overview.services.scheduler_last_completed_at).toLocaleString()}</small>}</div>)}
        </div><div className="emailCounts"><b><Mail size={15} /> Email delivery</b>{Object.entries(overview.email_deliveries).map(([status, count]) => <span key={status}>{status.replace(/_/g, ' ')} <strong>{count}</strong></span>)}</div><p className="adminFootnote">Scheduler health is based on a recent completed worker run. Capsule contents are never shown here.</p></div>
      </>}
      <div className="adminPanel adminUsers"><div className="adminPanelHead"><div><h2>User accounts</h2><p>{users ? `${users.total} accounts` : 'Search and manage account status.'}</p></div><label className="adminSearch"><Search size={16} /><input aria-label="Search users" placeholder="Search name or email" maxLength={120} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label></div>
        {loading && !users ? <div className="adminLoading">Loading accounts…</div> : users && users.users.length === 0 ? <div className="adminEmpty">No accounts match this search.</div> : users && <><div className="adminTableWrap"><table className="adminTable"><thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Role</th><th>Status</th><th><span className="visuallyHidden">Account actions</span></th></tr></thead><tbody>{users.users.map((account) => <tr key={account.id}><td data-label="Name">{account.name}</td><td data-label="Email">{account.email}</td><td data-label="Registered">{dateLabel(account.created_at)}</td><td data-label="Role"><span className={`rolePill ${account.role}`}>{account.role}</span></td><td data-label="Status"><span className={`statusPill ${account.account_status}`}>{account.account_status}</span></td><td data-label="Action"><button className="statusAction" disabled={account.role === 'admin' && account.account_status === 'active'} onClick={() => setSelected(account)}>{account.account_status === 'active' ? 'Disable' : 'Reactivate'}</button></td></tr>)}</tbody></table></div><div className="adminPagination"><span>Page {users.page} of {Math.max(1, users.pages)}</span><div><button aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /></button><button aria-label="Next page" disabled={page >= users.pages || loading} onClick={() => setPage((value) => Math.min(users.pages, value + 1))}><ChevronRight size={17} /></button></div></div></>}
      </div>
    </>}
    {selected && <dialog ref={dialogRef} className="adminDialog" aria-labelledby="statusDialogTitle" aria-describedby="statusDialogText" onCancel={(event) => { event.preventDefault(); if (!saving) setSelected(null); }} onClick={(event) => { if (event.target === event.currentTarget && !saving) setSelected(null); }}><div className="dialogIcon"><AlertTriangle size={20} /></div><h2 id="statusDialogTitle">{selected.account_status === 'active' ? 'Disable account?' : 'Reactivate account?'}</h2><p id="statusDialogText">{selected.account_status === 'active' ? `${selected.name} will lose access to the application immediately.` : `${selected.name} will be able to sign in and use the application again.`}</p><div className="dialogActions"><button autoFocus className="quiet" disabled={saving} onClick={() => setSelected(null)}>Cancel</button><button className="gold" disabled={saving} onClick={() => void changeStatus()}>{saving ? 'Saving…' : selected.account_status === 'active' ? 'Disable account' : <><Check size={15} /> Reactivate</>}</button></div></dialog>}
  </section>;
}
