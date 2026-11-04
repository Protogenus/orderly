import React, { createContext, useCallback, useContext, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

const ToastContext = createContext<{
  notify: (message: string) => void;
  notifyError: (message: string) => void;
}>({ notify: () => {}, notifyError: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: 'info' | 'error') => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const notify = useCallback((m: string) => push(m, 'info'), [push]);
  const notifyError = useCallback((m: string) => push(m, 'error'), [push]);

  return (
    <ToastContext.Provider value={{ notify, notifyError }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.kind === 'error' ? 'toast toast-error' : 'toast'}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Extract a human message from any thrown error. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'An unexpected error occurred.';
}
