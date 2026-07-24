import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ContainerLogs } from './ContainerLogs';

/**
 * jsdom has no EventSource, which is convenient: a stub makes these tests fully
 * deterministic — no network, and `ended`/`error` fire exactly when we say.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() {
    FakeEventSource.instances = [];
  }

  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  /** Deliver a server-sent event to the component. */
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }

  fail() {
    this.onerror?.(new Event('error'));
  }

  static get latest() {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let React flush the state updates a timer/event caused. */
const flush = async (ms = 0) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('ContainerLogs', () => {
  test('streams lines from the log events', async () => {
    render(<ContainerLogs id="abc" running />);
    await flush();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest.url).toContain('/api/servers/abc/logs/stream');

    await act(async () => {
      FakeEventSource.latest.emit('log', { line: 'Hosting game at port 34197' });
    });
    expect(screen.getByText(/Hosting game at port 34197/)).toBeTruthy();
  });

  test('re-attaches after a restart even though `running` never goes false', async () => {
    // The regression this guards: status polling can miss the gap entirely, so an
    // effect keyed only on `running` never fires and the viewer sits dead.
    render(<ContainerLogs id="abc" running />);
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1);

    // Container went away: the stream ends, but `running` is still true.
    await act(async () => {
      FakeEventSource.latest.emit('ended');
    });
    expect(screen.getByText('Not streaming')).toBeTruthy();
    expect(FakeEventSource.latest.closed).toBe(true);

    await flush(2000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  test('does not reconnect while the server is stopped', async () => {
    render(<ContainerLogs id="abc" running={false} />);
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1); // initial connect still happens

    await act(async () => {
      FakeEventSource.latest.emit('ended');
    });
    await flush(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test('backs off instead of spinning when the stream keeps dropping', async () => {
    render(<ContainerLogs id="abc" running />);
    await flush();

    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = FakeEventSource.instances.length;
      await act(async () => {
        FakeEventSource.latest.fail();
      });
      // Find how long we actually waited before a new connection appeared.
      let waited = 0;
      while (FakeEventSource.instances.length === before && waited < 60_000) {
        await flush(250);
        waited += 250;
      }
      delays.push(waited);
    }

    // Strictly increasing until the cap, and never busier than once a second.
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(15_000);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    expect(Math.max(...delays)).toBeGreaterThan(delays[0]); // it did back off
  });

  test('a stream that stays healthy resets the backoff', async () => {
    render(<ContainerLogs id="abc" running />);
    await flush();

    // Two quick failures push the backoff up.
    await act(async () => FakeEventSource.latest.fail());
    await flush(2000);
    await act(async () => FakeEventSource.latest.fail());
    await flush(4000);
    const afterBackoff = FakeEventSource.instances.length;

    // This one stays open past the health threshold, then drops.
    await flush(10_000);
    await act(async () => {
      FakeEventSource.latest.emit('ended');
    });
    await flush(2000);
    expect(FakeEventSource.instances.length).toBe(afterBackoff + 1);
  });

  test('the manual Reconnect button reconnects immediately', async () => {
    render(<ContainerLogs id="abc" running={false} />);
    await flush();
    await act(async () => {
      FakeEventSource.latest.emit('ended');
    });

    await act(async () => {
      screen.getByText('Reconnect').click();
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
