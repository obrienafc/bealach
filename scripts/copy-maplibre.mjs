// MapLibre runs as two halves, the page and a web worker, that must be the
// exact same build: the worker is found next to the main file, and a bundled
// main file paired with an unbundled worker silently fails to draw the
// basemap. So all three files are served as-is from public/, under the
// version, so the URL changes whenever MapLibre does and can be cached forever.
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('node_modules/maplibre-gl/package.json', 'utf8'));
const from = 'node_modules/maplibre-gl/dist';
const to = path.join('public/maplibre', pkg.version);

fs.rmSync('public/maplibre', { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
for (const file of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  fs.copyFileSync(path.join(from, file), path.join(to, file));
}
fs.writeFileSync('lib/maplibre-version.ts', `// Written by scripts/copy-maplibre.mjs.\nexport const MAPLIBRE_VERSION = '${pkg.version}';\n`);
console.log(`MapLibre ${pkg.version} worker copied to ${to}`);
