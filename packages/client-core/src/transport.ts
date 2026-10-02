/**
 * The client's one door to the network, as a function. `client-core` runs anywhere — the browser,
 * Node for the load tool, a test — so it names no `fetch`, no timer and no DOM: whoever builds the
 * client hands those in.
 */
export interface Request {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly token?: string;
}

/** A reply as it arrived: its status and its JSON, or `null` when the body was not JSON. */
export interface Response {
  readonly status: number;
  readonly body: unknown;
}

/** Resolves with any HTTP reply; rejects with a `TransportError` when no reply arrived at all. */
export type Transport = (request: Request) => Promise<Response>;

/** No reply: the connection failed, or the reply did not come in time. Retrying is safe (§7). */
export class TransportError extends Error {
  override readonly name = 'TransportError';
}

/** The slice of `fetch` the transport uses — so neither DOM nor Node types are needed to name it. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface HttpOptions {
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  readonly sleep: (ms: number) => Promise<void>;
  /** How long to wait for a reply before treating it as lost. */
  readonly timeoutMs?: number;
}

/**
 * `fetch` with a timeout. A reply that does not arrive in time is a lost reply: the request may
 * well have been applied, which is why every game request carries an `actionId` and the retry
 * reuses it. The late reply, if it ever lands, is ignored.
 */
export function httpTransport(options: HttpOptions): Transport {
  const timeoutMs = options.timeoutMs ?? 8000;
  return async (request) => {
    const headers: Record<string, string> = {};
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.token !== undefined) headers.authorization = `Bearer ${request.token}`;
    const call = options
      .fetch(`${options.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      })
      .then(async (res) => ({ status: res.status, body: parseJson(await res.text()) }))
      .catch((error: unknown) => {
        throw new TransportError(error instanceof Error ? error.message : 'network failure');
      });
    const timeout = options.sleep(timeoutMs).then(() => {
      throw new TransportError(`no reply in ${timeoutMs} ms`);
    });
    return Promise.race([call, timeout]);
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null; // a proxy's HTML error page, say — the status still says what happened
  }
}
