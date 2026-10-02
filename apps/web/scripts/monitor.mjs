// The frame monitor the browser probes share (decisions.mjs, hardening.mjs): one check per
// animation frame, in the page, against the truth the client holds —
//
//   - no card on the felt that no reply has dealt yet (every card shown is in the truth the client
//     holds now, or the one it held before: the screen may lag the truth, never lead it);
//   - no lit button the truth would refuse: an action outside `allowed`, or anything while a request
//     is out or the script is still playing; Deal only between rounds.

/** Starts watching `page`. Call once the table has booted (`window.__bj` is there). */
export function watch(page) {
  return page.evaluate(() => {
    const { client, stage } = window.__bj;
    const mon = { frames: 0, violations: [], prev: null, curr: client.state?.round ?? null };
    window.__mon = mon;
    client.subscribe(({ next }) => {
      mon.prev = mon.curr;
      mon.curr = next.round;
    });
    const counts = (round) => {
      const m = new Map();
      if (!round) return m;
      for (const c of [...round.dealer.cards, ...round.hands.flatMap((h) => h.cards)]) {
        m.set(c, (m.get(c) ?? 0) + 1);
      }
      return m;
    };
    const say = (what) => {
      if (mon.violations.length < 20) mon.violations.push({ frame: mon.frames, ...what });
    };
    const check = () => {
      mon.frames += 1;
      const known = counts(mon.prev);
      for (const [c, n] of counts(mon.curr)) known.set(c, Math.max(n, known.get(c) ?? 0));
      const shown = new Map();
      const table_ = stage.describe();
      for (const { face } of [...table_.dealer, ...table_.hands.flat()]) {
        if (face !== null) shown.set(face, (shown.get(face) ?? 0) + 1);
      }
      for (const [c, n] of shown) {
        if (n > (known.get(c) ?? 0)) say({ ahead: c, shown: n, known: known.get(c) ?? 0 });
      }
      const round = client.state?.round ?? null;
      // The stage's own word on whether the script has played — not the controller's gate, which is
      // the thing under test.
      const played = stage.position.done;
      for (const button of document.querySelectorAll('[data-action]')) {
        if (button.hidden || button.disabled) continue;
        const action = button.dataset.action;
        const ok = round !== null && round.allowed.includes(action) && !client.busy && played;
        if (!ok) say({ lit: action, busy: client.busy, played, allowed: round?.allowed });
      }
      const deal = document.querySelector('[data-deal]');
      if (!deal.disabled) {
        const between = round === null || round.phase === 'SETTLED';
        if (!between || client.busy || !played) say({ lit: 'deal', phase: round?.phase });
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** What the monitor saw on `page`: frames checked, and the first violations. */
export function seen(page) {
  return page.evaluate(() => ({
    frames: window.__mon.frames,
    violations: window.__mon.violations,
  }));
}
