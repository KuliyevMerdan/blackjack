import type { Client } from '@blackjack/client-core';

/**
 * Offline is not a place to stay. When the client's retries give up, the status says so — and then
 * the table keeps asking the server where the round is, every `everyMs`, while the page is in view
 * and nothing else is in flight. The first answer brings the table back as it stands, including
 * whatever the move that was lost did (§2.5): the player sees **Online**, not a pill they must
 * press something to clear.
 */
export function keepTrying(
  client: Pick<Client, 'status' | 'busy' | 'resync' | 'onStatus'>,
  deps: { sleep: (ms: number) => Promise<void>; visible: () => boolean; everyMs?: number },
): void {
  let trying = false;
  const loop = async () => {
    trying = true;
    while (client.status === 'offline') {
      await deps.sleep(deps.everyMs ?? 2000);
      if (client.status === 'offline' && deps.visible() && !client.busy) await client.resync();
    }
    trying = false;
  };
  client.onStatus((status) => {
    if (status === 'offline' && !trying) void loop();
  });
}
