import { useCallback, useEffect, useState } from 'react';
import type { ReportId, ReportResult } from '../../../shared/types.js';
import { useToast, errMsg } from '../components/Toast';
import { EmptyState } from '../components/ui';
import { Select } from '../components/forms';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { notify, notifyError } = useToast();
  const [list, setList] = useState<{ id: ReportId; label: string }[]>([]);
  const [reportId, setReportId] = useState<ReportId>('sales_over_time');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return iso(d);
  });
  const [to, setTo] = useState(() => iso(new Date()));
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    window.orderly
      .listReports()
      .then(setList)
      .catch((e) => notifyError(errMsg(e)));
  }, [notifyError]);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setResult(await window.orderly.runReport(reportId, from, to));
    } catch (e) {
      notifyError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }, [reportId, from, to, notifyError]);

  useEffect(() => {
    void run();
  }, [run]);

  const exportCsv = async () => {
    if (!result) return;
    try {
      const fileName = `orderly-report-${result.id}-${from}-to-${to}.csv`;
      const saved = await window.orderly.exportReportCsv(result.csv, fileName);
      notify(`Report saved to ${saved}`);
    } catch (e) {
      const m = errMsg(e);
      if (!/cancel/i.test(m)) notifyError(m);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Reports</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Select value={reportId} onChange={(e) => setReportId(e.target.value as ReportId)} aria-label="Report">
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
            {running ? 'Running…' : 'Run'}
          </button>
          {result && (
            <button className="btn btn-sm" onClick={exportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {!result ? (
        <EmptyState title="No report yet" body="Pick a report and a date range." />
      ) : (
        <>
          {result.note && (
            <div className="card" style={{ marginBottom: 10, padding: '8px 12px', fontSize: 12, color: 'var(--muted)' }}>
              {result.note}
            </div>
          )}
          {result.rows.length === 0 ? (
            <EmptyState title="No data in this range" body="Try a wider date range." />
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className={typeof cell === 'number' ? 'num' : undefined}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
