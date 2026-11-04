import React, { useEffect, useId, useRef, useState } from 'react';
import { formatCents } from '../../../shared/format.js';

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  // Associate the label with the first input-like child for accessibility.
  const kids = React.Children.map(children, (c, i) =>
    i === 0 && React.isValidElement(c) && !(c.props as any).id
      ? React.cloneElement(c as React.ReactElement<any>, { id })
      : c,
  );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {kids}
      {error && <span className="field-error">{error}</span>}
      {hint && !error && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} rows={props.rows ?? 3} />;
}

/**
 * Dollar-amount input bound to integer cents. Displays "12.50", commits cents on blur.
 * Invalid input shows an error and keeps the last valid value.
 */
export function MoneyInput({
  cents,
  onChange,
  id,
  ariaLabel,
}: {
  cents: number;
  onChange: (cents: number) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  const [error, setError] = useState('');
  const lastCommitted = useRef(cents);

  useEffect(() => {
    if (cents !== lastCommitted.current) {
      lastCommitted.current = cents;
      setText((cents / 100).toFixed(2));
      setError('');
    }
  }, [cents]);

  function commit() {
    const t = text.replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) {
      setError('Enter an amount like 12.50');
      return;
    }
    const [d, c = ''] = t.split('.');
    const value = parseInt(d, 10) * 100 + parseInt((c + '00').slice(0, 2), 10);
    setError('');
    lastCommitted.current = value;
    onChange(value);
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: 'var(--muted)' }}>$</span>
        <input
          id={id}
          aria-label={ariaLabel}
          className={`input mono ${error ? 'input-error' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          style={{ width: 110 }}
        />
      </span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span className="num">{formatCents(cents)}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="modal"
        style={wide ? { width: 'min(880px, 94vw)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
