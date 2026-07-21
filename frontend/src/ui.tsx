import { useEffect, useRef, useState } from 'react';

export type NoticeKind = 'error' | 'success' | 'info';
export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
  time: number;
}

let seq = 0;
let history: Notice[] = [];
const HISTORY_CAP = 300;
const TOAST_MS = 10_000;

// Two channels: `historyListeners` fires with the full log (for the notifications
// center), `toastListeners` fires per new notice (for the ephemeral toasts).
const historyListeners = new Set<(h: Notice[]) => void>();
const toastListeners = new Set<(n: Notice) => void>();

function emitHistory() {
  for (const l of historyListeners) l(history);
}

export function subscribeHistory(l: (h: Notice[]) => void): () => void {
  historyListeners.add(l);
  return () => historyListeners.delete(l);
}
export function subscribeToasts(l: (n: Notice) => void): () => void {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
}
export function getHistory(): Notice[] {
  return history;
}
export function clearHistory(): void {
  history = [];
  emitHistory();
}

/** Show a toast AND record it in the notifications history. */
export function toast(message: string, kind: NoticeKind = 'info') {
  const n: Notice = { id: ++seq, kind, message, time: Date.now() };
  history = [n, ...history].slice(0, HISTORY_CAP);
  emitHistory();
  for (const l of toastListeners) l(n);
}
export const toastError = (m: string) => toast(m, 'error');
export const toastSuccess = (m: string) => toast(m, 'success');

/** A single toast that auto-dismisses after TOAST_MS, but pauses while hovered. */
function ToastItem({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const startTimer = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(onDismiss, TOAST_MS);
  };
  useEffect(() => {
    startTimer();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`toast ${notice.kind}`}
      onMouseEnter={() => clearTimeout(timer.current)}
      onMouseLeave={startTimer}
    >
      <span className="toast-msg">{notice.message}</span>
      <button className="toast-close" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(
    () =>
      subscribeToasts((n) => {
        setItems((cur) => [...cur, n]);
      }),
    [],
  );
  const dismiss = (id: number) => setItems((cur) => cur.filter((x) => x.id !== id));
  return (
    <div className="toast-stack">
      {items.map((t) => (
        <ToastItem key={t.id} notice={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
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
