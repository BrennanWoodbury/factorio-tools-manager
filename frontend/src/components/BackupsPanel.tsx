import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { BackupInfo, GlobalDefaults, Server } from '../types';
import { run, toastError, toastSuccess } from '../ui';
import { OverridableField } from './OverridableField';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupsPanel({ server, onChanged }: { server: Server; onChanged?: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [defaults, setDefaults] = useState<GlobalDefaults | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackups((await api.listBackups(server.id)).backups);
    } catch (err) {
      toastError((err as Error).message);
    }
  }, [server.id]);

  useEffect(() => {
    void load();
    api.getGlobalDefaults().then((r) => setDefaults(r.defaults)).catch(() => {});
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

  // Per-field override: editing commits an override, the reset button re-inherits.
  const commit = (patch: Record<string, unknown>) =>
    run(() => api.updateServer(server.id, patch), 'Saved').then((ok) => ok && onChanged?.());
  const reset = (setting: string) =>
    run(() => api.resetServerSetting(server.id, setting), 'Reset to global default').then(
      (ok) => ok && onChanged?.(),
    );

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
        up a running server forces a fresh save first. Manual and automatic backups have separate
        retention — one never evicts the other, and a manual backup doesn't delay the auto schedule.
      </div>

      {/* Backup settings — each field inherits the global default until overridden. */}
      {defaults && (
        <div style={{ marginBottom: 6, maxWidth: 480 }}>
          <OverridableField
            label="Automatic backups"
            kind="bool"
            value={server.autoBackup}
            globalValue={defaults.autoBackup}
            overridden={server.overrides.autoBackup}
            onCommit={(v) => void commit({ autoBackup: v })}
            onReset={() => void reset('autoBackup')}
          />
          <OverridableField
            label="Every (minutes)"
            kind="number"
            min={5}
            value={server.backupIntervalMinutes}
            globalValue={defaults.backupIntervalMinutes}
            overridden={server.overrides.backupIntervalMinutes}
            onCommit={(v) => void commit({ backupIntervalMinutes: v })}
            onReset={() => void reset('backupIntervalMinutes')}
          />
          <OverridableField
            label="Keep auto (newest N)"
            kind="number"
            min={1}
            value={server.backupKeep}
            globalValue={defaults.backupKeep}
            overridden={server.overrides.backupKeep}
            onCommit={(v) => void commit({ backupKeep: v })}
            onReset={() => void reset('backupKeep')}
          />
          <OverridableField
            label="Keep manual (newest N)"
            kind="number"
            min={1}
            value={server.backupKeepManual}
            globalValue={defaults.backupKeepManual}
            overridden={server.overrides.backupKeepManual}
            onCommit={(v) => void commit({ backupKeepManual: v })}
            onReset={() => void reset('backupKeepManual')}
          />
        </div>
      )}

      {backups.length === 0 ? (
        <div className="small muted" style={{ marginTop: 12 }}>
          No backups yet.
        </div>
      ) : (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Save</th>
              <th>Size</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td>
                  <span className={`badge ${b.kind === 'auto' ? 'running' : 'stopped'}`}>
                    <span className="dot" />
                    {b.kind === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                </td>
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
                      Restore from here
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
