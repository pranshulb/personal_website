// Module resolution hook: points `import ... from '@vercel/blob'` at the stub
// for the duration of a test run, so the handlers under api/ are imported
// exactly as written and nothing has to be planted in node_modules.
const STUB = new URL('./blob-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === '@vercel/blob') return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
