/**
 * @blackjack/fair — the commit, the HMAC byte stream, and the unbiased Fisher–Yates that turn two
 * seeds into a shoe (ADR-0001, docs/protocol.md §3).
 *
 * **Isomorphic.** The server deals with it and the browser's verification page checks with it —
 * the same code, never a second implementation that could drift. SHA-256 and HMAC are written here
 * in plain TypeScript for that reason.
 */
export { bytesToHex, hexToBytes, utf8 } from './bytes.js';
export { sha256, hmacSha256, hmacKey, type HmacKey } from './sha256.js';
export {
  SERVER_SEED,
  CLIENT_SEED,
  DECKS,
  commit,
  verifyCommit,
  wordStream,
  below,
  shuffleInPlace,
  shoe,
} from './shoe.js';
