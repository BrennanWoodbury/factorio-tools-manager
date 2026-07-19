import { useEffect, useState } from 'react';

type Toast = { id: number; kind: 'error' | 'success' | 'info'; message: string };
let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, kind, message };
  listeners.forEach((l) => l(t));
}
export const toastError = (m: string) => toast(m, 'error');
export const toastSuccess = (m: string) => toast(m, 'success');

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 4500);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <>
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.message}
        </div>
      ))}
    </>
  );
}

/** Wrap an async action, surfacing thrown errors as a toast. */
export async function run(fn: () => Promise<unknown>, okMsg?: string) {
  try {
    await fn();
    if (okMsg) toastSuccess(okMsg);
    return true;
  } catch (err) {
    toastError((err as Error).message);
    return false;
  }
}
