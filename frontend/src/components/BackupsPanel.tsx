import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { BackupInfo, Server } from '../types';
import { run, toastError, toastSuccess } from '../ui';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupsPanel({ server, onChanged }: { server: Server; onChanged?: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);

  // Auto-backup settings (persisted via updateServer)
  const [auto, setAuto] = useState(server.autoBackup);
  const [interval, setIntervalMin] = useState(server.backupIntervalMinutes);
  const [keep, setKeep] = useState(server.backupKeep);
  const [savingCfg, setSavingCfg] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackups((await api.listBackups(server.id)).backups);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const backupNow = async () => {
    setBusy(true);
    const ok = await run(async () => {
      const r = await api.backupNow(server.id);
      setBackups(r.backups);
    }, 'Backup created');
    setBusy(false);
    if (ok) void load();
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    await run(
      () =>
        api.updateServer(server.id, {
          autoBackup: auto,
          backupIntervalMinutes: interval,
          backupKeep: keep,
        }),
      'Backup settings saved',
    );
    setSavingCfg(false);
    onChanged?.();
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Backups</h2>
        <button className="primary" disabled={busy} onClick={() => void backupNow()}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        Snapshots of a save kept under the server's <span className="mono">backups/</span> dir. Backing
        up a running server forces a fresh save first.
      </div>

      {/* Auto-backup settings */}
      <div className="row" style={{ alignItems: 'flex-end', gap: 14, marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Automatic backups
        </label>
        <div>
          <label>Every (minutes)</label>
          <input
            type="number"
            min={5}
            style={{ width: 110 }}
            value={interval}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
          />
        </div>
        <div>
          <label>Keep (newest N)</label>
          <input
            type="number"
            min={1}
            style={{ width: 110 }}
            value={keep}
            onChange={(e) => setKeep(Number(e.target.value))}
          />
        </div>
        <button disabled={savingCfg} onClick={() => void saveCfg()}>
          {savingCfg ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {backups.length === 0 ? (
        <div className="small muted" style={{ marginTop: 12 }}>
          No backups yet.
        </div>
      ) : (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Backup</th>
              <th>Save</th>
              <th>Size</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td className="mono small">{b.name}</td>
                <td className="mono">{b.source}</td>
                <td>{fmtSize(b.sizeBytes)}</td>
                <td className="small muted">{new Date(b.createdAt).toLocaleString()}</td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <a href={api.downloadBackupUrl(server.id, b.name)}>
                      <button className="small">Download</button>
                    </a>
                    <button
                      className="small"
                      onClick={async () => {
                        if (
                          !confirm(
                            `Restore this backup into the "${b.source}" save and select it? The server must be stopped.`,
                          )
                        )
                          return;
                        const ok = await run(
                          () => api.restoreBackup(server.id, b.name),
                          `Restored to "${b.source}"`,
                        );
                        if (ok) {
                          toastSuccess('Start the server to load the restored save.');
                          onChanged?.();
                        }
                      }}
                    >
                      Restore
                    </button>
                    <button
                      className="danger small"
                      onClick={async () => {
                        if (!confirm(`Delete backup "${b.name}"?`)) return;
                        await run(() => api.deleteBackup(server.id, b.name), 'Deleted');
                        await load();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
