export function createRefreshGate(runRefresh) {
  let inFlight = null;
  let queued = false;

  const run = async () => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        await runRefresh();
      } finally {
        inFlight = null;
        if (queued) {
          queued = false;
          void run();
        }
      }
    })();
    return inFlight;
  };

  return run;
}
