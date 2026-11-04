import { useState } from 'react';
import type { ImportAnalysisDto, ImportApplyDto, ImportValidationDto } from '../../../shared/types.js';
import { useToast, errMsg } from '../components/Toast';
import { Field, Select } from '../components/forms';
import { EmptyState } from '../components/ui';

type ImportKind = 'customers' | 'products' | 'orders';

const KIND_LABEL: Record<ImportKind, string> = {
  customers: 'Customers',
  products: 'Products',
  orders: 'Orders',
};

const STEPS = ['Choose data', 'Pick file', 'Inspect', 'Map columns', 'Preview', 'Validate', 'Confirm', 'Results'];

function Stepper({ step }: { step: number }) {
  return (
    <ol
      style={{
        display: 'flex',
        gap: 4,
        listStyle: 'none',
        padding: 0,
        margin: '0 0 14px',
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li
            key={label}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              background: active ? 'var(--ink)' : done ? 'var(--sage-soft)' : 'var(--surface)',
              color: active ? 'var(--paper)' : done ? 'var(--ink)' : 'var(--muted)',
              border: '1px solid var(--border)',
            }}
            aria-current={active ? 'step' : undefined}
          >
            {n}. {label}
          </li>
        );
      })}
    </ol>
  );
}

function ImportWizard() {
  const { notify, notifyError } = useToast();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<ImportKind>('orders');
  const [analysis, setAnalysis] = useState<ImportAnalysisDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [validation, setValidation] = useState<ImportValidationDto | null>(null);
  const [result, setResult] = useState<ImportApplyDto | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep(1);
    setAnalysis(null);
    setMapping({});
    setValidation(null);
    setResult(null);
  };

  const pickFile = async () => {
    setBusy(true);
    try {
      const path = await window.orderly.pickCsvFile();
      if (!path) return; // user canceled
      const a = await window.orderly.importAnalyze(kind, path);
      setAnalysis(a);
      setMapping({ ...a.autoMapping });
      setValidation(null);
      setResult(null);
      setStep(3);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runValidation = async () => {
    if (!analysis) return;
    setBusy(true);
    try {
      const v = await window.orderly.importValidate(analysis.jobId, mapping);
      setValidation(v);
      setStep(6);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!analysis) return;
    setBusy(true);
    try {
      const r = await window.orderly.importApply(analysis.jobId);
      setResult(r);
      setStep(8);
      notify(`Imported ${r.imported} ${kind}.`);
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const mappedPreview = (): { field: string; label: string; values: string[] }[] => {
    if (!analysis) return [];
    return analysis.fields
      .filter((f) => mapping[f.key])
      .map((f) => ({
        field: f.key,
        label: f.label,
        values: analysis.sampleRows.slice(0, 8).map((r) => r[mapping[f.key]!] ?? ''),
      }));
  };

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>Import from CSV</h2>
      <Stepper step={step} />

      {step === 1 && (
        <div>
          <Field label="What are you importing?">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
              <option value="orders">Orders (one row per line item; rows sharing an order number become one order)</option>
              <option value="customers">Customers</option>
              <option value="products">Products</option>
            </Select>
          </Field>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            The import runs as a single transaction: if anything fails, nothing is imported. Existing records are never
            overwritten — duplicates are flagged and skipped.
          </p>
          <button className="btn btn-primary" onClick={() => setStep(2)}>
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <p style={{ fontSize: 13 }}>Choose the CSV file containing your {KIND_LABEL[kind].toLowerCase()}.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={pickFile} disabled={busy}>
              {busy ? 'Reading…' : 'Choose CSV file…'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && analysis && (
        <div>
          <p style={{ fontSize: 13 }}>
            Found {analysis.totalRows} data rows and {analysis.columns.length} columns:
          </p>
          <div className="card" style={{ padding: 0, maxHeight: 220, overflow: 'auto', marginBottom: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  {analysis.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.sampleRows.map((r, i) => (
                  <tr key={i}>
                    {analysis.columns.map((c) => (
                      <td key={c} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(2)}>
              Pick a different file
            </button>
            <button className="btn btn-primary" onClick={() => setStep(4)}>
              Map columns
            </button>
          </div>
        </div>
      )}

      {step === 4 && analysis && (
        <div>
          <p style={{ fontSize: 13 }}>Match each Orderly field to a column in your file. Required fields must be mapped.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginBottom: 12 }}>
            {analysis.fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
                <Select
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                >
                  <option value="">— not mapped —</option>
                  {analysis.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(3)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={() => setStep(5)}>
              Preview
            </button>
          </div>
        </div>
      )}

      {step === 5 && analysis && (
        <div>
          <p style={{ fontSize: 13 }}>First 8 rows as Orderly will read them:</p>
          <div className="card" style={{ padding: 0, maxHeight: 260, overflow: 'auto', marginBottom: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  {mappedPreview().map((p) => (
                    <th key={p.field}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    {mappedPreview().map((p) => (
                      <td key={p.field} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.values[i] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mappedPreview().length === 0 && <EmptyState title="Nothing mapped" body="Go back and map at least one column." />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(4)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={runValidation} disabled={busy || mappedPreview().length === 0}>
              {busy ? 'Validating…' : 'Validate'}
            </button>
          </div>
        </div>
      )}

      {step === 6 && validation && (
        <div>
          <p style={{ fontSize: 13 }}>
            {validation.validRows} of {analysis!.totalRows} rows are ready to import.
          </p>
          {validation.duplicates.length > 0 && (
            <div className="card" style={{ marginBottom: 10, borderLeft: '4px solid var(--amber)' }}>
              <strong>{validation.duplicates.length} duplicate{validation.duplicates.length === 1 ? '' : 's'} will be skipped</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {validation.duplicates.slice(0, 10).map((d, i) => (
                  <li key={i}>Row {d.row}: {d.reason}</li>
                ))}
                {validation.duplicates.length > 10 && <li>…and {validation.duplicates.length - 10} more</li>}
              </ul>
            </div>
          )}
          {validation.errors.length > 0 && (
            <div className="card" style={{ marginBottom: 10, borderLeft: '4px solid var(--danger)' }}>
              <strong>{validation.errors.length} row{validation.errors.length === 1 ? ' has' : 's have'} errors and will be excluded</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {validation.errors.slice(0, 10).map((d, i) => (
                  <li key={i}>{d.message}</li>
                ))}
                {validation.errors.length > 10 && <li>…and {validation.errors.length - 10} more</li>}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(5)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={() => setStep(7)} disabled={validation.validRows === 0}>
              Continue to confirm
            </button>
          </div>
        </div>
      )}

      {step === 7 && validation && (
        <div>
          <p style={{ fontSize: 13 }}>
            Import <strong className="num">{validation.validRows}</strong> new {KIND_LABEL[kind].toLowerCase()}?
            {validation.duplicates.length > 0 && ` ${validation.duplicates.length} duplicates will be skipped.`}
            {validation.errors.length > 0 && ` ${validation.errors.length} rows with errors will be excluded.`}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>
            This runs as one transaction — it either fully succeeds or leaves your data untouched.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(6)}>
              Back
            </button>
            <button className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? 'Importing…' : `Import ${validation.validRows} ${KIND_LABEL[kind].toLowerCase()}`}
            </button>
          </div>
        </div>
      )}

      {step === 8 && result && (
        <div>
          <p style={{ fontSize: 13 }}>
            {result.imported} {KIND_LABEL[kind].toLowerCase()} imported.
            {result.skipped > 0 && ` ${result.skipped} skipped.`}
          </p>
          {result.errors.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 10 }}>
              <strong>The import failed partway and was rolled back — nothing was changed.</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12 }}>
                {result.errors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn btn-primary" onClick={reset}>
            Start a new import
          </button>
        </div>
      )}
    </div>
  );
}

export function IntegrationsPage({ onGo }: { onGo: (page: 'production' | 'settings') => void }) {
  const { notify, notifyError } = useToast();

  const exportCsv = async (kind: 'orders' | 'customers' | 'products') => {
    try {
      const path = await window.orderly.exportCsv(kind);
      notify(`Exported to ${path}`);
    } catch (e) {
      const m = errMsg(e);
      if (!/cancel/i.test(m)) notifyError(m);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Integrations</h1>
      </div>

      <ImportWizard />

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Export to CSV</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Download your data any time. Amounts are written as dollars (e.g. 18.50); re-importing converts them back to cents.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => exportCsv('orders')}>Export orders</button>
          <button className="btn" onClick={() => exportCsv('customers')}>Export customers</button>
          <button className="btn" onClick={() => exportCsv('products')}>Export products</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>StagePoint</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Production handoffs to StagePoint use a local file-drop contract: Orderly writes a JSON envelope to its outbox
          (or a StagePoint inbox folder you choose), and StagePoint replies with an acknowledgment file. Nothing is sent
          over the network. Manage handoffs on the Production page.
        </p>
        <button className="btn" onClick={() => onGo('production')}>Open Production</button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>Connected services</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Orderly has no marketplace or storefront connections. It does not sync with Etsy, Shopify, Amazon, or any other
          sales channel — orders from those channels arrive via CSV import. If a connection appears here in the future,
          it will say so explicitly; nothing here is implied or simulated.
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Data portability is covered by CSV import/export above and backup/restore in{' '}
          <button className="linklike" onClick={() => onGo('settings')}>Settings</button>.
        </p>
      </div>
    </div>
  );
}
