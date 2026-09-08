// Module resolution hook: points `import ... from '@vercel/blob'` at the stub
// for the duration of a test run, so the handlers under api/ are imported
// exactly as written and nothing has to be planted in node_modules. The
// store's own `./_seed.js` is swapped the same way, so the tests see an
// empty (and fillable) seed rather than the real list.
const STUB = new URL('./blob-stub.mjs', import.meta.url).href;
const SEED_STUB = new URL('./seed-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@vercel/blob') return { url: STUB, shortCircuit: true };
  if (specifier === './_seed.js' && /\/api\/community\/_store\.js$/.test(context.parentURL || '')) {
    return { url: SEED_STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
