"use strict";

// In-process per-item mutex: chains async work for the same Client
// Pipeline item id so overlapping processing runs strictly one after
// another. This is a race-reduction optimization only — the map is empty
// after a process restart and does nothing across replicas; the durable
// correctness guarantee is the Pipeline Activity EventKey check (see
// lib/stage-engine.js).
function createItemLock() {
  const chains = new Map(); // itemId -> settled tail promise

  function withItemLock(itemId, fn) {
    const tail = chains.get(itemId) || Promise.resolve();
    const next = tail.then(() => fn());
    const settled = next.then(
      () => {},
      () => {},
    );
    chains.set(itemId, settled);
    settled.then(() => {
      if (chains.get(itemId) === settled) chains.delete(itemId);
    });
    return next;
  }

  return { withItemLock };
}

module.exports = { createItemLock };
