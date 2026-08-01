// Persists sequencer state (rows + bpm) to localStorage so patterns survive
// page reloads, and to the URL hash so they can be shared/bookmarked by
// copying the address bar. Saved data is versioned but never migrated - a
// breaking schema change just bumps SCHEMA_VERSION and old saves are silently
// discarded rather than upgraded, since patterns aren't meant to be kept
// forever. Additive changes (a new Row/Trigger field) don't need a bump at
// all: see hydrateRow below.
import { createRow, type Row, type Trigger } from './types';

const STORAGE_KEY = 'efdp-sequencer-state';
const SCHEMA_VERSION = 1;

// Shape of the raw parsed JSON, before rows are hydrated into full `Row`s -
// `unknown[]` rather than `Row[]` since nothing has actually checked each
// row's fields yet at this point, only that `rows` itself is an array.
interface RawPersistedState {
	version: number;
	bpm: number;
	rows: unknown[];
}

function isTrigger(value: unknown): value is Partial<Trigger> {
	return typeof value === 'object' && value !== null;
}

// Rebuilds a row from saved data on top of createRow's defaults, so any field
// added to Row/Trigger after a save was written - and therefore missing from
// its JSON - falls back to the same default a brand new row would get,
// instead of coming back undefined. createRow stays the single source of
// truth for those defaults; this only merges, it never redefines them.
function hydrateRow(saved: Partial<Row> & Pick<Row, 'id'>): Row {
	const base = createRow({
		id: saved.id,
		name: saved.name ?? 'Row',
		sampleId: saved.sampleId ?? '',
		length: saved.length,
		subdivision: saved.subdivision
	});

	const triggers = Array.isArray(saved.triggers)
		? base.triggers.map((defaultTrigger, i) => {
				const savedTrigger = saved.triggers?.[i];
				return isTrigger(savedTrigger) ? { ...defaultTrigger, ...savedTrigger } : defaultTrigger;
			})
		: base.triggers;

	return { ...base, ...saved, triggers };
}

function isPersistedState(value: unknown): value is RawPersistedState {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.version === SCHEMA_VERSION &&
		typeof candidate.bpm === 'number' &&
		Array.isArray(candidate.rows)
	);
}

// Shared by the localStorage and URL-hash loaders: turns parsed-but-unverified
// JSON into a real { bpm, rows } once it's confirmed to be current-version and
// well-shaped, hydrating each row the same way regardless of where it came from.
function parsePersistedState(parsed: unknown): { bpm: number; rows: Row[] } | null {
	if (!isPersistedState(parsed)) return null;
	const rows = parsed.rows
		.filter(
			(row): row is Partial<Row> & Pick<Row, 'id'> =>
				typeof row === 'object' && row !== null && typeof (row as Row).id === 'string'
		)
		.map(hydrateRow);
	return { bpm: parsed.bpm, rows };
}

// Returns null for anything that isn't a validly-shaped, current-version
// save - a missing key, corrupt JSON, and an old version all look the same
// from here: just start fresh.
export function loadPersistedState(): { bpm: number; rows: Row[] } | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return parsePersistedState(JSON.parse(raw));
	} catch {
		return null;
	}
}

let saveTimeout: ReturnType<typeof setTimeout> | undefined;

// Debounced so rapid changes (dragging a fader, holding a step toggle) don't
// each force a synchronous localStorage write on the main thread.
export function schedulePersist(bpm: number, rows: Row[]): void {
	clearTimeout(saveTimeout);
	saveTimeout = setTimeout(() => {
		const state: RawPersistedState = { version: SCHEMA_VERSION, bpm, rows };
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Quota exceeded or localStorage disabled (e.g. private browsing) -
			// losing autosave silently beats surfacing it to the user.
		}
	}, 400);
}

// --- URL sharing -----------------------------------------------------------
// The same { version, bpm, rows } shape saved to localStorage above, but
// gzipped and base64url-encoded into the URL hash instead. A step grid is
// mostly repeated defaults (inactive triggers, velocity/probability/iteration
// all at 1), and JSON's repeated key names on top of that compress very well
// - typically an order of magnitude smaller than the raw JSON - which keeps
// the hash short enough to be a practical, copy-pasteable share link. The
// hash (not a query string) is used so the pattern never leaves the browser
// on a request to the static host.

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// Takes/returns Uint8Array<ArrayBuffer> specifically (not the bare, wider
// Uint8Array<ArrayBufferLike>) - CompressionStream's writer only accepts a
// BufferSource backed by a real ArrayBuffer, never a SharedArrayBuffer.
async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const cs = new CompressionStream('gzip');
	const writer = cs.writable.getWriter();
	writer.write(bytes);
	writer.close();
	return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	writer.write(bytes);
	writer.close();
	return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Encodes the current pattern for the URL hash. Can throw (e.g. on a browser
// without CompressionStream) - callers decide how to degrade.
export async function encodeStateToFragment(bpm: number, rows: Row[]): Promise<string> {
	const state: RawPersistedState = { version: SCHEMA_VERSION, bpm, rows };
	const json = new TextEncoder().encode(JSON.stringify(state));
	return toBase64Url(await gzip(json));
}

// Mirrors loadPersistedState, but starting from a URL hash fragment instead
// of localStorage. Same "anything malformed just means start fresh" contract:
// a stale/hand-edited/truncated link degrades to null rather than throwing.
export async function decodeStateFromFragment(
	fragment: string
): Promise<{ bpm: number; rows: Row[] } | null> {
	try {
		const json = new TextDecoder().decode(await gunzip(fromBase64Url(fragment)));
		return parsePersistedState(JSON.parse(json));
	} catch {
		return null;
	}
}

let urlSyncTimeout: ReturnType<typeof setTimeout> | undefined;

// Debounced the same way as schedulePersist, and on the same rapid-change
// reasoning - plus each call does an async compression round trip, which a
// synchronous per-keystroke call would pile up. Uses replaceState (not
// pushState) so every edit doesn't spam browser history with one entry each;
// the address bar still always reflects the latest pattern for copying.
export function scheduleUrlSync(bpm: number, rows: Row[]): void {
	clearTimeout(urlSyncTimeout);
	urlSyncTimeout = setTimeout(() => {
		encodeStateToFragment(bpm, rows)
			.then((fragment) => {
				history.replaceState(null, '', `#${fragment}`);
			})
			.catch(() => {
				// Compression unsupported, or nothing to encode - leave the URL as-is.
			});
	}, 400);
}
