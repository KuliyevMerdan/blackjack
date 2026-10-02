/** Byte helpers that run unchanged in Node and the browser — no `Buffer`, no `TextEncoder` needed. */

const HEX = /^(?:[0-9a-f]{2})*$/;

export function hexToBytes(hex: string): Uint8Array {
  if (!HEX.test(hex)) throw new RangeError('not lowercase hex of whole bytes');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * UTF-8 by hand. A client seed is printable ASCII (docs/protocol.md §3.1), where UTF-8 is the
 * identity, but the encoder is total so a counter or anything else hashed later cannot surprise it.
 */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return Uint8Array.from(out);
}
