/**
 * @blackjack/client-core — the truth and the wire: HTTP transport, the session, the truth store,
 * `actionId` + `seq` discipline, retry and resync. **No DOM**: the browser, the load tool and the
 * tests each hand it a `fetch`, a timer and somewhere to keep a token.
 */
export {
  Client,
  InvariantError,
  canonical,
  type Change,
  type ClientOptions,
  type Outcome,
  type Status,
  type Truth,
} from './client.js';
export {
  httpTransport,
  TransportError,
  type FetchLike,
  type HttpOptions,
  type Request,
  type Response,
  type Transport,
} from './transport.js';
export { inMemory, SentRounds, type KeyValue, type Sent } from './memory.js';
