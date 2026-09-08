// Stand-in for api/community/_seed.js during tests (swapped in by hooks.mjs),
// so the suite doesn't depend on whatever the real seed holds today. Empty by
// default; a test fills it in place, and the runner empties it before the next.
export default [];
