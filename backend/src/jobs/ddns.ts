import type { AppConfig } from '../config.js';
import type { DnsService } from '../services/dnsService.js';

/**
 * Dynamic-DNS job. On a fixed interval it asks an external "what's my IP" service
 * for the host's current public IP and, if it changed, updates the single shared
 * `host.<base>` A record. Every server's SRV record targets that name, so one
 * update follows the WAN IP for all servers at once.
 */
export class DdnsJob {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastError?: string;
  private lastIp?: string;
  private lastCheck?: string;

  constructor(
    private readonly dns: DnsService,
    private readonly config: AppConfig,
  ) {}

  private async detectPublicIp(): Promise<string> {
    const res = await fetch(this.config.ipCheckUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`IP check returned HTTP ${res.status}`);
    const text = (await res.text()).trim();
    // Accept a bare IPv4 (api.ipify.org default response).
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
      throw new Error(`Unexpected IP check response: ${text.slice(0, 64)}`);
    }
    return text;
  }

  async runOnce(): Promise<void> {
    if (!this.dns.enabled) return;
    this.lastCheck = new Date().toISOString();
    try {
      const ip = await this.detectPublicIp();
      const changed = await this.dns.ensureHostARecord(ip);
      this.lastIp = ip;
      this.lastError = undefined;
      if (changed) console.log(`[ddns] updated host A record → ${ip}`);
    } catch (err) {
      this.lastError = (err as Error).message;
      console.warn(`[ddns] check failed: ${this.lastError}`);
    }
  }

  start(): void {
    if (!this.dns.enabled) {
      console.log('[ddns] DNS disabled — DDNS job not started');
      return;
    }
    if (this.running) return;
    this.running = true;
    // Fire once shortly after boot, then on the configured interval.
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.config.ddnsIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
  }

  status() {
    return {
      enabled: this.dns.enabled,
      running: this.running,
      lastIp: this.lastIp,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      intervalSeconds: this.config.ddnsIntervalMs / 1000,
    };
  }
}
