// Loaded with `node --import ./test/register.mjs …` (see package.json scripts).
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
