export function StatusBadge({ running }: { running: boolean }) {
  return (
    <span className={`badge ${running ? 'running' : 'stopped'}`}>
      <span className="dot" />
      {running ? 'Running' : 'Stopped'}
    </span>
  );
}
