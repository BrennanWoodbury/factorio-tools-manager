import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Server, ServerStatus, SystemStatus } from '../types';
import { CreateServerForm } from './CreateServerForm';
import { StatusBadge } from './StatusBadge';
import { WhitelistPanel } from './WhitelistPanel';
import { DnsSettingsPanel } from './DnsSettingsPanel';

export function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    const { servers } = await api.listServers();
    setServers(servers);
    const results = await Promise.all(
      servers.map((s) => api.status(s.id).catch(() => null)),
    );
    const map: Record<string, ServerStatus> = {};
    results.forEach((r, i) => {
      if (r) map[servers[i].id] = r;
    });
    setStatuses(map);
  }, []);

  useEffect(() => {
    void refresh();
    void api.systemStatus().then(setSystem).catch(() => {});
    const t = setInterval(() => void refresh(), 5000);
    const t2 = setInterval(() => void api.systemStatus().then(setSystem).catch(() => {}), 10000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
    };
  }, [refresh]);

  return (
    <>
      {system && <SystemPanel system={system} />}

      <div className="spread" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Servers ({servers.length})</h2>
        <button className="primary" onClick={() => setShowCreate(true)}>
          + New server
        </button>
      </div>

      {servers.length === 0 && (
        <div className="panel muted">No servers yet. Create one to get started.</div>
      )}

      {servers.map((s) => {
        const st = statuses[s.id];
        const running = st?.running ?? s.status === 'running';
        return (
          <div key={s.id} className="server-card" onClick={() => onOpen(s.id)}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</div>
              <div className="small muted mono">
                {s.connectHost ?? `port ${s.gamePort}`}
                {' · '}
                {s.subdomain}
              </div>
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              {running && st?.players && (
                <span className="small muted">
                  👥 {st.players.count}
                  {s.maxPlayers > 0 ? ` / ${s.maxPlayers}` : ''}
                </span>
              )}
              <StatusBadge running={running} />
            </div>
          </div>
        );
      })}

      <details style={{ marginTop: 18 }}>
        <summary className="muted" style={{ cursor: 'pointer', marginBottom: 10 }}>
          DNS / Cloudflare settings
        </summary>
        <DnsSettingsPanel />
      </details>

      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ cursor: 'pointer', marginBottom: 10 }}>
          Global whitelist (applies to every server)
        </summary>
        <WhitelistPanel
          title="Global whitelist"
          description="These Factorio usernames may join every server, on top of each server's own whitelist. Leave empty to disable. Applies to each server on its next start/restart."
          load={async () => (await api.getGlobalWhitelist()).whitelist}
          save={async (names) => (await api.setGlobalWhitelist(names)).whitelist}
        />
      </details>

      {showCreate && (
        <CreateServerForm
          dnsEnabled={system?.dns.enabled ?? false}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            void refresh();
            onOpen(id);
          }}
        />
      )}
    </>
  );
}

function SystemPanel({ system }: { system: SystemStatus }) {
  return (
    <div className="panel">
      <div className="row" style={{ gap: 12 }}>
        <div className="stat">
          <div className="n" style={{ color: system.docker.ok ? 'var(--green)' : 'var(--red)' }}>
            {system.docker.ok ? 'OK' : 'DOWN'}
          </div>
          <div className="l">Docker</div>
        </div>
        <div className="stat">
          <div className="n">
            {system.ports.game.used}
            <span className="muted" style={{ fontSize: 14 }}>
              /{system.ports.game.total}
            </span>
          </div>
          <div className="l">Game ports used</div>
        </div>
        <div className="stat">
          <div className="n">{system.ports.rcon.free}</div>
          <div className="l">RCON ports free</div>
        </div>
        <div className="stat">
          <div className="n" style={{ color: system.dns.enabled ? 'var(--green)' : 'var(--muted)' }}>
            {system.dns.enabled ? 'ON' : 'OFF'}
          </div>
          <div className="l">DNS automation</div>
        </div>
        {system.dns.enabled && (
          <div className="stat">
            <div className="n mono" style={{ fontSize: 15 }}>
              {system.ddns.lastIp ?? '—'}
            </div>
            <div className="l">Public IP {system.ddns.lastError ? '(error)' : ''}</div>
          </div>
        )}
      </div>
      {system.dns.enabled && (
        <div className="small muted" style={{ marginTop: 10 }}>
          SRV target: <span className="mono">{system.dns.hostRecord}</span> · base domain{' '}
          <span className="mono">{system.dns.baseDomain}</span>
          {system.ddns.lastError && (
            <span style={{ color: 'var(--red)' }}> · DDNS: {system.ddns.lastError}</span>
          )}
        </div>
      )}
      {!system.docker.ok && system.docker.error && (
        <div className="small" style={{ color: 'var(--red)', marginTop: 10 }}>
          Docker: {system.docker.error}
        </div>
      )}
    </div>
  );
}
