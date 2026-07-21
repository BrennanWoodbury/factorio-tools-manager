import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { DnsSettings } from '../types';
import { run, toastError, toastSuccess } from '../ui';

/**
 * Cloudflare / DNS settings, edited entirely here (nothing in env). Configuring
 * base domain, host record, zone ID and API token enables automatic SRV records
 * per server plus the DDNS A-record sync.
 */
export function DnsSettingsPanel() {
  const [dns, setDns] = useState<DnsSettings | null>(null);
  const [baseDomain, setBaseDomain] = useState('');
  const [hostRecordName, setHostRecordName] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [token, setToken] = useState('');
  const [interval, setIntervalSecs] = useState(300);
  const [ipCheckUrl, setIpCheckUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { dns } = await api.getDns();
      setDns(dns);
      setBaseDomain(dns.baseDomain);
      setHostRecordName(dns.hostRecordName);
      setZoneId(dns.cloudflareZoneId);
      setIntervalSecs(dns.ddnsIntervalSeconds);
      setIpCheckUrl(dns.ipCheckUrl);
      setToken('');
    } catch (err) {
      toastError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!dns) return null;

  const save = async () => {
    setBusy(true);
    const patch: Record<string, unknown> = {
      baseDomain,
      hostRecordName,
      cloudflareZoneId: zoneId,
      ddnsIntervalSeconds: interval,
      ipCheckUrl,
    };
    // Only send the token when the admin actually typed one (blank keeps the current).
    if (token.trim()) patch.cloudflareToken = token.trim();
    await run(async () => {
      const r = await api.setDns(patch);
      setDns(r.dns);
      setToken('');
    }, 'DNS settings saved');
    setBusy(false);
    await load();
  };

  const clearToken = async () => {
    if (!confirm('Remove the Cloudflare API token? This disables DNS automation.')) return;
    await run(() => api.setDns({ cloudflareToken: '' }), 'Token cleared');
    await load();
  };

  const test = async () => {
    setTestResult('Testing…');
    try {
      const r = await api.testDns();
      setTestResult(r.ok ? `✓ Connected to zone "${r.zoneName}"` : `✗ ${r.error}`);
      if (r.ok) toastSuccess('Cloudflare connection OK');
    } catch (err) {
      setTestResult(`✗ ${(err as Error).message}`);
    }
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>
          DNS / Cloudflare{' '}
          <span className={`badge ${dns.enabled ? 'running' : 'stopped'}`} style={{ marginLeft: 6 }}>
            <span className="dot" />
            {dns.enabled ? 'Active' : 'Off'}
          </span>
        </h2>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="small muted" style={{ marginBottom: 12 }}>
        Set all four fields to enable automatic per-server SRV records + DDNS. Stored in the app's
        database (not env). Token needs <span className="mono">Zone:DNS:Edit</span> on the zone.
      </div>

      <div className="row">
        <div className="grow">
          <label>Base domain</label>
          <input
            className="mono"
            placeholder="mydomain.com"
            value={baseDomain}
            onChange={(e) => setBaseDomain(e.target.value)}
          />
        </div>
        <div className="grow">
          <label>Host record (SRV target + A record)</label>
          <input
            className="mono"
            placeholder="host.mydomain.com"
            value={hostRecordName}
            onChange={(e) => setHostRecordName(e.target.value)}
          />
        </div>
      </div>

      <DnsRecordsPreview baseDomain={baseDomain} hostRecordName={hostRecordName} />

      <div className="row">
        <div className="grow">
          <label>Cloudflare Zone ID</label>
          <input
            className="mono"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
          />
        </div>
        <div className="grow">
          <label>API token {dns.hasToken ? '(set — blank keeps it)' : '(not set)'}</label>
          <input
            type="password"
            placeholder={dns.hasToken ? '••••••••' : 'Cloudflare API token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <div className="grow">
          <label>DDNS check interval (seconds)</label>
          <input
            type="number"
            min={30}
            value={interval}
            onChange={(e) => setIntervalSecs(Number(e.target.value))}
          />
        </div>
        <div className="grow">
          <label>Public-IP check URL</label>
          <input
            className="mono"
            value={ipCheckUrl}
            onChange={(e) => setIpCheckUrl(e.target.value)}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
        <button onClick={() => void test()} disabled={!dns.hasToken}>
          Test connection
        </button>
        {dns.hasToken && (
          <button className="danger ghost" onClick={() => void clearToken()}>
            Clear token (disable)
          </button>
        )}
        {testResult && (
          <span
            className="small"
            style={{ color: testResult.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}
          >
            {testResult}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Live preview of the DNS records that will be created, driven by the base domain
 * and host record currently typed into the form — updates as you type.
 */
function DnsRecordsPreview({
  baseDomain,
  hostRecordName,
}: {
  baseDomain: string;
  hostRecordName: string;
}) {
  const base = baseDomain.trim().toLowerCase();
  if (!base) {
    return (
      <div className="small muted" style={{ margin: '4px 0 12px' }}>
        Set a base domain to preview the DNS records that will be created.
      </div>
    );
  }
  const host = hostRecordName.trim().toLowerCase() || `host.${base}`;
  return (
    <div className="small muted" style={{ margin: '4px 0 12px', lineHeight: 1.7 }}>
      <div>
        <strong>Preview</strong> (updates as you type):
      </div>
      <div>
        A record <span className="mono">{host}</span> → your public IP
      </div>
      <div>
        Example server <span className="mono">factory1</span> connects to{' '}
        <span className="mono">factory1.{base}</span>
      </div>
      <div>
        via SRV <span className="mono">_factorio._udp.factory1.{base}</span> →{' '}
        <span className="mono">{host}:34197</span>
      </div>
    </div>
  );
}
