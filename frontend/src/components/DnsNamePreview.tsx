/**
 * Live preview of the DNS name players would connect to for a server, given a
 * subdomain and the configured base domain — updates as either is typed. The
 * connect host is `<subdomain>.<baseDomain>`; the SRV record Factorio looks up is
 * `_factorio._udp.<subdomain>.<baseDomain>`.
 */
export function DnsNamePreview({
  subdomain,
  baseDomain,
  enabled = true,
  exampleSubdomain = 'factory1',
  style,
}: {
  subdomain: string;
  baseDomain: string | null | undefined;
  /** Whether DNS automation is fully configured; when false, a hint is appended. */
  enabled?: boolean;
  /** Placeholder subdomain used in the preview when none is typed yet. */
  exampleSubdomain?: string;
  style?: React.CSSProperties;
}) {
  const base = (baseDomain ?? '').trim().toLowerCase();
  if (!base) {
    return (
      <div className="small muted" style={{ marginTop: 4, ...style }}>
        No base domain set — players connect by <span className="mono">IP:port</span>.
      </div>
    );
  }
  const sub = (subdomain.trim() || exampleSubdomain).toLowerCase();
  const host = `${sub}.${base}`;
  return (
    <div className="small muted" style={{ marginTop: 4, ...style }}>
      Players connect to <span className="mono">{host}</span>
      {!enabled && ' (finish DNS setup to activate)'}
      <div style={{ marginTop: 2 }}>
        SRV <span className="mono">_factorio._udp.{host}</span>
      </div>
    </div>
  );
}
