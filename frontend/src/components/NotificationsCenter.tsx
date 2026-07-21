import { useEffect, useState } from 'react';
import {
  clearHistory,
  getHistory,
  subscribeHistory,
  type Notice,
} from '../ui';

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString();
}

const kindIcon: Record<Notice['kind'], string> = { error: '⛔', success: '✅', info: 'ℹ️' };

/**
 * Header bell that opens a persistent log of every notification (the same ones
 * shown as toasts, including inline errors). Shows an unread count for notices
 * that arrived since the panel was last opened.
 */
export function NotificationsCenter() {
  const [items, setItems] = useState<Notice[]>(getHistory());
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(Date.now());

  useEffect(() => subscribeHistory((h) => setItems([...h])), []);

  const unread = items.filter((n) => n.time > lastSeen).length;

  const toggle = () => {
    if (!open) setLastSeen(Date.now());
    setOpen((o) => !o);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="ghost" onClick={toggle} title="Notifications">
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            <div className="spread" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <strong>Notifications</strong>
              <div className="row">
                <button className="ghost small" onClick={() => clearHistory()} disabled={items.length === 0}>
                  Clear
                </button>
                <button className="ghost small" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="notif-list">
              {items.length === 0 && (
                <div className="muted small" style={{ padding: 16, textAlign: 'center' }}>
                  No notifications yet.
                </div>
              )}
              {items.map((n) => (
                <div key={n.id} className={`notif-item ${n.kind}`}>
                  <span className="notif-icon">{kindIcon[n.kind]}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="notif-msg">{n.message}</div>
                    <div className="small muted">{fmtTime(n.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
