# Load — the P0 soak

`pnpm load -- --sessions 200 --minutes 30` (`tools/load`). Its last full run is
[`soak.json`](soak.json), written by the tool and kept as it wrote it.

## What it does

A **production-mode** server (`BJ_ENV=production`) on a SQLite file with `BJ_FAULTS=on`, started by
the tool. 200 sessions play basic strategy through `client-core` — the browser's own client — with
a 0.4–1.5 s pause between decisions; 20 of them have a **second tab** on the same session, both
playing, each resyncing when it hears the other moved. About 60 % of the sessions inject faults
into their own requests (§9): up to 600 ms of latency, 5–15 % of deal and act replies **dropped
after the move applied**, 3 % refused `UNAVAILABLE`, and every 20 s a few of them get a storm of
three refusals. Every five minutes the server is **SIGKILLed** — not stopped — and started again on
the same file; the faults, which live in its memory, are set again.

Then, with the faults off, the **audit** — over the wire, as any client could do it, with no look
into the database:

1. every wallet equals its starting balance, less every stake its rounds put at risk, plus every
   payout (the history, and the open round);
2. the server holds every deal and decision a tab was told was accepted, and nothing beyond them
   but — at most — the ones whose fate no tab learned (its retries ran out, or a `CONFLICT`
   answered a retry whose stored reply had been superseded, §7);
3. a session with **one** tab was never answered with a `CONFLICT`;
4. every round's public record (`/fair`) has every card it dealt on the table exactly once;
5. every settled round any tab was shown is the server's record of it, byte for byte, and every tab
   ends on the server's open round and wallet.

## The last run — 2026-10-02

**31.1 minutes, 5 SIGKILLs, 413,314 requests (23,395 of them lost on the
wire — dropped, or cut off by a kill), 138,445 rounds, 192,475 decisions: zero findings.**
37 deals and decisions landed without their tab being told — each exactly once, found by
the bound in check 2 — the twins met 7,778 conflicts, 9 intents ran out of retries, and
the tabs resynced 40,124 times.

Round trips as `client-core` timed them, in ms, on one laptop (server and 220 clients in two
processes). "Clean" is the sessions without faults; the faulted column is mostly the latency they
asked for.

| Endpoint | Requests (clean) | p50 | p90 | p99 | max | faulted p50 · p99 |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/deal` | 60,251 | 1 | 3 | 11 | 964 | 254 · 593 |
| `/api/act` | 83,873 | 2 | 3 | 11 | 1068 | 255 · 593 |
| `/api/round` | 15,125 | 1 | 2 | 8 | 629 | 200 · 589 |

## The run before it, and what it found

The first full run reported **26 findings**, all of one kind: the server held one more deal or
decision than a tab had been told was accepted. None was a money, card or display finding. Each was
a move whose tab never learned its fate — twelve intents had run out of retries (a storm, a drop and
a kill in a row), and in the twin sessions a lost reply's stored copy had been superseded by the
other tab's next round before the retry came, so the retry was answered `STALE_SEQ` (§7 names that
case). The server had applied each **once**; the audit had counted only `ok` answers. It now counts
the intents whose fate was untold and holds the server between the two bounds — and, so as not to
lose the case that would mean real double play, a session with one tab may not see a conflict at
all.

The audit was checked against a mutant before it was trusted: with the server's `actionId` replay
switched off, a one-minute run of 20 sessions produced 18 findings — single-tab sessions answered
with conflicts, and more rounds held than every deal the tabs ever sent.
