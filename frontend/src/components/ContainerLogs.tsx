import { useCallback, useEffect, useRef, useState } from 'react';

/** Classify a log line for coloring (Factorio prefixes errors/warnings). */
function lineClass(line: string): string | undefined {
  if (/\berror\b|\bfailed\b|exception|fatal/i.test(line)) return 'log-err';
  if (/\bwarn(ing)?\b/i.test(line)) return 'log-warn';
  return undefined;
}

/**
 * Live viewer for a server's Docker container logs (stdout/stderr) — distinct from the
 * RCON console. Streams over SSE (scrollback + follow), reconnecting when the server
 * (re)starts. Works stopped too: you still see the last container's output.
 */
export function ContainerLogs({ id, running }: { id: string; running: boolean }) {
  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [live, setLive] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  /** Consecutive short-lived attempts, for backoff. Reset once a stream proves healthy. */
  const attemptsRef = useRef(0);
  const healthyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    setLive(true);
    const es = new EventSource(`/api/servers/${id}/logs/stream?tail=1000`, { withCredentials: true });
    esRef.current = es;

    // A stream that survives this long counts as a success. `onopen` is not a usable
    // signal: the endpoint opens, replays scrollback and ends immediately for a
    // container that is already gone, which would reset the backoff every cycle.
    healthyRef.current = setTimeout(() => {
      attemptsRef.current = 0;
    }, 10_000);

    const done = () => {
      if (healthyRef.current) clearTimeout(healthyRef.current);
      attemptsRef.current += 1;
      setLive(false);
      es.close();
    };

    es.addEventListener('log', (e) => {
      const { line } = JSON.parse((e as MessageEvent).data) as { line: string };
      setLines((l) => (l.length > 6000 ? [...l.slice(-5000), line] : [...l, line]));
    });
    es.addEventListener('ended', done);
    es.onerror = done;
  }, [id]);

  const reconnect = useCallback(() => {
    attemptsRef.current = 0;
    connect();
  }, [connect]);

  // Connect on mount; tear down on unmount.
  useEffect(() => {
    connect();
    return () => {
      if (healthyRef.current) clearTimeout(healthyRef.current);
      esRef.current?.close();
    };
  }, [connect]);

  /**
   * Re-attach whenever the server is up but we aren't streaming. Keying on `live` as well
   * as `running` is what makes a *restart* recover: the container going away ends the
   * stream (`live` → false) while `running` may never be observed as false in between —
   * status polling can miss the gap entirely — so an effect watching only `running` never
   * fires and the viewer sits dead on "Not streaming". Backoff keeps a server that reports
   * up but immediately drops the stream from spinning.
   */
  const prevRunning = useRef(running);
  useEffect(() => {
    if (running && !prevRunning.current) attemptsRef.current = 0; // a fresh start earns a fast retry
    prevRunning.current = running;
    if (!running || live) return;
    const delay = Math.min(1000 * 2 ** attemptsRef.current, 15_000);
    const t = setTimeout(connect, delay);
    return () => clearTimeout(t);
  }, [running, live, connect]);

  // Follow the tail unless the user paused it.
  useEffect(() => {
    if (follow) boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [lines, follow]);

  const download = () => {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `factorio-${id}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 10 }}>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span className={`log-dot ${live ? 'on' : ''}`} />
          <span className="small muted">{live ? 'Live' : 'Not streaming'}</span>
          <span className="small muted">· container stdout / stderr</span>
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            <span className="small">Follow</span>
          </label>
          {!live && (
            <button className="ghost small" onClick={reconnect}>
              Reconnect
            </button>
          )}
          <button className="ghost small" onClick={() => setLines([])}>
            Clear
          </button>
          <button className="ghost small" disabled={lines.length === 0} onClick={download}>
            Download
          </button>
        </div>
      </div>
      <div className="console" ref={boxRef}>
        {lines.length === 0 ? (
          <span className="muted">Waiting for output…</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={lineClass(l)}>
              {l}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
