// Regenerates static/samples/manifest.json from whatever audio files actually
// sit in static/samples, so the in-app sample picker never needs a manual
// update when samples are added/removed. Runs as a pre-step before dev/build
// (see package.json) since this app is a static-adapter SPA with no server
// available at runtime to list the directory on demand.
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const samplesDir = fileURLToPath(new URL('../static/samples', import.meta.url));
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a']);

const entries = await readdir(samplesDir);
const samples = entries
	.filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
	.sort((a, b) => a.localeCompare(b));

await writeFile(path.join(samplesDir, 'manifest.json'), JSON.stringify(samples, null, '\t') + '\n');

console.log(
	`generate-sample-manifest: wrote ${samples.length} entries to static/samples/manifest.json`
);
