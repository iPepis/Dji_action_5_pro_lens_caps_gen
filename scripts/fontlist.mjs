// Ordered list of bundled font files. Earlier = preferred when several fonts have the same character.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fonts');
const group = (n) => n.startsWith('noto-emoji') ? 1 : n.startsWith('noto-sans-symbols-2') ? 3
  : n.startsWith('noto-sans-symbols') ? 2 : 0;   // plain Noto Sans first so digits/letters never come from the emoji font

export const fontFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.ttf'))
  .sort((a, b) => group(a) - group(b) || a.localeCompare(b)).map((f) => path.join(dir, f));
