#!/usr/bin/env python3
"""
An independent implementation of the shoe in docs/protocol.md §3, for the golden test.

Written from the document, not from packages/fair: Python's hashlib and hmac, and integer
arithmetic. Its output is src/__fixtures__/golden.ts; the TypeScript under test never computes its
own expected values. Run from packages/fair:

    python3 golden/shuffle.py > src/__fixtures__/golden.ts
"""
import hashlib
import hmac

RANKS = "A23456789TJQK"
SUITS = "SHDC"


def canonical_shoe(decks):
    return [r + s for _ in range(decks) for s in SUITS for r in RANKS]


def words(server_seed_hex, client_seed):
    key = bytes.fromhex(server_seed_hex)
    k = 0
    while True:
        block = hmac.new(key, f"{client_seed}:{k}".encode("utf-8"), hashlib.sha256).digest()
        for i in range(0, 32, 4):
            yield int.from_bytes(block[i : i + 4], "big")
        k += 1


def shoe(server_seed_hex, client_seed, decks=6):
    cards = canonical_shoe(decks)
    stream = words(server_seed_hex, client_seed)
    for i in range(len(cards) - 1, 0, -1):
        n = i + 1
        limit = 2**32 - (2**32 % n)
        while True:
            w = next(stream)
            if w < limit:
                break
        j = w % n
        cards[i], cards[j] = cards[j], cards[i]
    return cards


CLIENT_SEEDS = [
    "a",
    "~",
    " ",
    "0",
    "player-seed",
    "client seed with spaces",
    "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
    "x" * 64,
    "0123456789abcdef0123456789abcdef",
    "The quick brown fox jumps over the lazy dog",
]


def main():
    rows = []
    for i in range(30):
        server = hashlib.sha256(f"blackjack-golden-{i}".encode()).hexdigest()
        client = CLIENT_SEEDS[i % len(CLIENT_SEEDS)] if i < 20 else f"seed-{i}"
        commit = hashlib.sha256(bytes.fromhex(server)).hexdigest()
        rows.append((server, client, commit, shoe(server, client)[:20]))
    full = shoe(rows[0][0], rows[0][1])

    def ts(s):
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

    print("/**")
    print(" * Golden vectors, computed by an independent implementation — golden/shuffle.py, Python's")
    print(" * hashlib and hmac and integer arithmetic, written from docs/protocol.md §3 and not from this")
    print(" * package. Server seeds are `SHA256(\"blackjack-golden-<i>\")`. Regenerate, never hand-edit:")
    print(" *")
    print(" *     python3 golden/shuffle.py > src/__fixtures__/golden.ts")
    print(" */")
    print()
    print("export interface GoldenShoe {")
    print("  readonly serverSeed: string;")
    print("  readonly clientSeed: string;")
    print("  readonly commit: string;")
    print("  /** The first 20 cards dealt. */")
    print("  readonly top: readonly string[];")
    print("}")
    print()
    print("export const GOLDEN: readonly GoldenShoe[] = [")
    for server, client, commit, top in rows:
        print("  {")
        print(f"    serverSeed: '{server}',")
        print(f"    clientSeed: {ts(client)},")
        print(f"    commit: '{commit}',")
        print("    top: [" + ", ".join(f"'{c}'" for c in top) + "],")
        print("  },")
    print("];")
    print()
    print("/** The whole 312-card shoe for `GOLDEN[0]` — every position, not only the top. */")
    print("export const GOLDEN_FULL: readonly string[] = [")
    for i in range(0, len(full), 13):
        print("  " + ", ".join(f"'{c}'" for c in full[i : i + 13]) + ",")
    print("];")


if __name__ == "__main__":
    main()
