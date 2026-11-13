// Bundles src/ into one self-contained index.html (wasm + fonts inlined). Run: npm run build
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontFiles } from './fontlist.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// virtual module: every bundled font as a Uint8Array, in priority order
const fontsPlugin = {
  name: 'fonts-all',
  setup(b) {
    b.onResolve({ filter: /^fonts:all$/ }, () => ({ path: 'fonts:all', namespace: 'fonts' }));
    b.onLoad({ filter: /.*/, namespace: 'fonts' }, () => ({
      resolveDir: root,
      contents: fontFiles.map((f, i) => `import f${i} from ${JSON.stringify(f)};`).join('\n')
        + `\nexport default [${fontFiles.map((_, i) => `f${i}`).join(',')}];`,
    }));
  },
};

export const bundle = async (entry) => (await build({
  entryPoints: [path.join(root, entry)], bundle: true, minify: true, format: 'iife', platform: 'browser',
  write: false, loader: { '.wasm': 'binary', '.ttf': 'binary' }, target: 'es2020', plugins: [fontsPlugin],
  define: { 'import.meta.url': '"file:///capmaker/"', 'process.env.NODE_ENV': '"production"' },
  external: ['fs', 'path', 'module', 'url', 'worker_threads', 'node:*'], logLevel: 'warning',
})).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const js = await bundle('src/main.js');
  const html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8').replace('/*__BUNDLE__*/', () => js);
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log('built index.html', (html.length / 1024 / 1024).toFixed(1), 'MB');
}
