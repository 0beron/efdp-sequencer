// Persists sequencer state (rows + bpm) to localStorage so patterns survive
// page reloads. Saved data is versioned but never migrated - a breaking
// schema change just bumps SCHEMA_VERSION and old saves are silently
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

// Returns null for anything that isn't a validly-shaped, current-version
// save - a missing key, corrupt JSON, and an old version all look the same
// from here: just start fresh.
export function loadPersistedState(): { bpm: number; rows: Row[] } | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isPersistedState(parsed)) return null;
		const rows = parsed.rows
			.filter(
				(row): row is Partial<Row> & Pick<Row, 'id'> =>
					typeof row === 'object' && row !== null && typeof (row as Row).id === 'string'
			)
			.map(hydrateRow);
		return { bpm: parsed.bpm, rows };
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
