import { kvGet, kvSet, type DB } from '../db/index.js';

/**
 * DNS / Cloudflare settings, persisted in the DB (kv) and edited entirely from the
 * dashboard — there are no DNS environment variables. DNS automation is "enabled"
 * only when the token, zone, base domain and host record are all set.
 */
export interface DnsSettings {
  baseDomain: string;
  hostRecordName: string;
  cloudflareZoneId: string;
  cloudflareToken: string;
  ddnsIntervalSeconds: number;
  ipCheckUrl: string;
}

const K = {
  baseDomain: 'dns_base_domain',
  hostRecordName: 'dns_host_record',
  zoneId: 'dns_zone_id',
  token: 'dns_token',
  interval: 'dns_ddns_interval_seconds',
  ipCheckUrl: 'dns_ip_check_url',
} as const;

export const DEFAULT_DDNS_INTERVAL = 300;
export const DEFAULT_IP_CHECK_URL = 'https://api.ipify.org';

export function getDnsSettings(db: DB): DnsSettings {
  const interval = Number(kvGet(db, K.interval));
  return {
    baseDomain: kvGet(db, K.baseDomain) ?? '',
    hostRecordName: kvGet(db, K.hostRecordName) ?? '',
    cloudflareZoneId: kvGet(db, K.zoneId) ?? '',
    cloudflareToken: kvGet(db, K.token) ?? '',
    ddnsIntervalSeconds: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_DDNS_INTERVAL,
    ipCheckUrl: kvGet(db, K.ipCheckUrl) || DEFAULT_IP_CHECK_URL,
  };
}

export interface DnsSettingsPatch {
  baseDomain?: string;
  hostRecordName?: string;
  cloudflareZoneId?: string;
  cloudflareToken?: string; // '' clears it (disables DNS)
  ddnsIntervalSeconds?: number;
  ipCheckUrl?: string;
}

export function setDnsSettings(db: DB, patch: DnsSettingsPatch): void {
  if (patch.baseDomain !== undefined) kvSet(db, K.baseDomain, patch.baseDomain.trim().toLowerCase());
  if (patch.hostRecordName !== undefined)
    kvSet(db, K.hostRecordName, patch.hostRecordName.trim().toLowerCase());
  if (patch.cloudflareZoneId !== undefined) kvSet(db, K.zoneId, patch.cloudflareZoneId.trim());
  if (patch.cloudflareToken !== undefined) kvSet(db, K.token, patch.cloudflareToken.trim());
  if (patch.ddnsIntervalSeconds !== undefined)
    kvSet(db, K.interval, String(Math.max(30, Math.floor(patch.ddnsIntervalSeconds))));
  if (patch.ipCheckUrl !== undefined) kvSet(db, K.ipCheckUrl, patch.ipCheckUrl.trim());
}

/** DNS automation is on only when everything it needs is present. */
export function dnsEnabled(s: DnsSettings): boolean {
  return Boolean(s.cloudflareToken && s.cloudflareZoneId && s.baseDomain && s.hostRecordName);
}

/** UI-facing view: token is never returned, only whether it's set. */
export function dnsSettingsDto(s: DnsSettings) {
  return {
    baseDomain: s.baseDomain,
    hostRecordName: s.hostRecordName,
    cloudflareZoneId: s.cloudflareZoneId,
    hasToken: s.cloudflareToken !== '',
    ddnsIntervalSeconds: s.ddnsIntervalSeconds,
    ipCheckUrl: s.ipCheckUrl,
    enabled: dnsEnabled(s),
  };
}
