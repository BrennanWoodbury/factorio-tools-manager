import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Line {
  kind: 'cmd' | 'out' | 'err';
  text: string;
}

/** Live RCON console. Commands go to the server over loopback; output streams back. */
export function Console({ id, running }: { id: string; running: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [lines]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    const command = cmd;
    setCmd('');
    setLines((l) => [...l, { kind: 'cmd', text: `> ${command}` }]);
    setBusy(true);
    try {
      const { response } = await api.rcon(id, command);
      setLines((l) => [...l, { kind: 'out', text: response || '(no output)' }]);
    } catch (err) {
      setLines((l) => [...l, { kind: 'err', text: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      {!running && (
        <div className="small muted" style={{ marginBottom: 10 }}>
          Server is stopped — start it to use the console.
        </div>
      )}
      <div className="console" ref={boxRef}>
        {lines.length === 0 && (
          <span className="muted">
            RCON console. Try <span className="mono">/help</span>, <span className="mono">/players online</span>,{' '}
            <span className="mono">/time</span>.
          </span>
        )}
        {lines.map((l, i) => (
          <div key={i} className={l.kind === 'cmd' ? 'cmd' : l.kind === 'err' ? 'err' : ''}>
            {l.text}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="row" style={{ marginTop: 10 }}>
        <input
          className="grow mono"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder={running ? '/command or Lua…' : 'server stopped'}
          disabled={!running || busy}
        />
        <button className="primary" disabled={!running || busy}>
          Send
        </button>
      </form>
    </div>
  );
}
