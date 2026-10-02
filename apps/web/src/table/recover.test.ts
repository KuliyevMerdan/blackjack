import type { Status } from '@blackjack/client-core';
import { describe, expect, it } from 'vitest';
import { keepTrying } from './recover.js';

/** A client whose resyncs fail `failing` times, then answer. */
function fake(failing: number) {
  const listeners = new Set<(s: Status) => void>();
  let status: Status = 'online';
  const set = (s: Status) => {
    status = s;
    listeners.forEach((l) => l(s));
  };
  const client = {
    resyncs: 0,
    get status() {
      return status;
    },
    busy: false,
    async resync() {
      client.resyncs += 1;
      set(client.resyncs > failing ? 'online' : 'offline');
      return { kind: 'ok' as const };
    },
    onStatus(listener: (s: Status) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { client, set };
}

describe('keepTrying', () => {
  it('asks again while offline, and stops at the first answer', async () => {
    const { client, set } = fake(2);
    const waits: number[] = [];
    keepTrying(client, { sleep: async (ms) => void waits.push(ms), visible: () => true });
    set('offline');
    await new Promise((r) => setTimeout(r, 0));
    expect(client.status).toBe('online');
    expect(client.resyncs).toBe(3);
    expect(waits).toEqual([2000, 2000, 2000]);
  });

  it('asks nothing while the page is hidden', async () => {
    const { client, set } = fake(0);
    let visible = false;
    let ticks = 0;
    keepTrying(client, {
      sleep: async () => {
        ticks += 1;
        if (ticks === 3) visible = true;
      },
      visible: () => visible,
    });
    const resync = client.resync.bind(client);
    let askedAt = 0;
    client.resync = async () => {
      askedAt = ticks;
      return resync();
    };
    set('offline');
    await new Promise((r) => setTimeout(r, 0));
    expect(client.resyncs).toBe(1);
    expect(askedAt).toBe(3); // not on the two waits while hidden
    expect(client.status).toBe('online');
  });
});
