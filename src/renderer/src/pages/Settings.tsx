import { useEffect, useState } from 'react';
import { getAppInfo, getSettings, setSetting, createBackup, restoreBackup } from '../api';
import { useToast, errMsg } from '../components/Toast';
import { ConfirmDialog } from '../components/ui';

export function SettingsPage() {
  const { notify, notifyError } = useToast();
  const [info, setInfo] = useState<{ version: string; dataDir: string; dbPath: string } | null>(null);
  const [company, setCompany] = useState('');
  const [prefix, setPrefix] = useState('ORD-');
  const [currency, setCurrency] = useState('USD');
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [i, s] = await Promise.all([getAppInfo(), getSettings()]);
        setInfo(i);
        setCompany(s.company_name ?? '');
        setPrefix(s.order_number_prefix ?? 'ORD-');
        setCurrency(s.default_currency ?? 'USD');
      } catch (e) {
        notifyError(errMsg(e));
      }
    })();
  }, [notifyError]);

  async function save() {
    setSaving(true);
    try {
      if (!/^[A-Z0-9-]{1,12}$/.test(prefix)) {
        notifyError('Order number prefix must be 1–12 characters: letters, digits, or dashes.');
        return;
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        notifyError('Currency must be a 3-letter code like USD.');
        return;
      }
      await setSetting('company_name', company.trim());
      await setSetting('order_number_prefix', prefix);
      await setSetting('default_currency', currency.toUpperCase());
      notify('Settings saved.');
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function backup() {
    setBackingUp(true);
    try {
      const r = await createBackup();
      notify(`Backup saved to ${r.path}`);
    } catch (e) {
      if ((e as Error & { code?: string }).code !== 'CANCELED') notifyError(errMsg(e));
    } finally {
      setBackingUp(false);
    }
  }

  async function restore() {
    setConfirmRestore(false);
    try {
      await restoreBackup();
      // App relaunches on success; if we get here it was canceled.
    } catch (e) {
      notifyError(errMsg(e));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Business preferences, data location, and database safety.</p>
        </div>
      </div>

      <div className="card">
        <h3>Business</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="company">Company name</label>
            <input
              id="company"
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
              placeholder="Your business name"
            />
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <input
              id="currency"
              className="input mono"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="USD"
            />
            <span className="hint">3-letter code. All money is stored as integer cents.</span>
          </div>
          <div className="field">
            <label htmlFor="prefix">Order number prefix</label>
            <input
              id="prefix"
              className="input mono"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              maxLength={12}
            />
            <span className="hint">New orders are numbered like {prefix}1001.</span>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Database</h3>
        <dl className="kv">
          <dt>Version</dt>
          <dd className="mono">{info?.version ?? '—'}</dd>
          <dt>Data folder</dt>
          <dd className="mono" style={{ wordBreak: 'break-all' }}>{info?.dataDir ?? '—'}</dd>
          <dt>Database file</dt>
          <dd className="mono" style={{ wordBreak: 'break-all' }}>{info?.dbPath ?? '—'}</dd>
        </dl>
        <hr className="divider" />
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
          Back up regularly. Restoring replaces the current database after making a safety backup of it first.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={backup} disabled={backingUp}>
            {backingUp ? 'Backing up…' : 'Back up now…'}
          </button>
          <button className="btn" onClick={() => setConfirmRestore(true)}>
            Restore from backup…
          </button>
        </div>
      </div>

      {confirmRestore && (
        <ConfirmDialog
          title="Restore database"
          body="Choose a backup file. Your current database will be replaced — a safety backup of it is made first, and the app will restart."
          confirmLabel="Choose backup file…"
          onConfirm={restore}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
    </div>
  );
}
