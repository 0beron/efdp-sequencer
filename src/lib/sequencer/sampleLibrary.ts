// Catalog of samples available under static/samples, for the row sample
// picker. The file list itself comes from a manifest generated at build/dev
// time (see scripts/generate-sample-manifest.mjs) rather than being read at
// runtime, since this app ships as a static SPA with no server to list a
// directory on demand.
import { asset } from '$app/paths';

export interface SampleEntry {
	// Filename without its extension; doubles as the row's sampleId.
	id: string;
	file: string;
	url: string;
	label: string;
}

export function toLabel(id: string): string {
	return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

let cache: Promise<SampleEntry[]> | null = null;

export function loadSampleLibrary(): Promise<SampleEntry[]> {
	if (!cache) {
		cache = fetch(asset('/samples/manifest.json'))
			.then((res) => res.json() as Promise<string[]>)
			.then((files) =>
				files
					.map((file) => {
						const id = file.replace(/\.[^./]+$/, '');
						return { id, file, url: asset(`/samples/${file}`), label: toLabel(id) };
					})
					.sort((a, b) => a.label.localeCompare(b.label))
			);
	}
	return cache;
}
