<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { asset } from '$app/paths';
	import { SequencerEngine } from '$lib/sequencer/engine.svelte';
	import { createRow } from '$lib/sequencer/types';
	import SequencerRow, { type OverlayKind } from '$lib/components/SequencerRow.svelte';
	import { loadSampleLibrary, type SampleEntry } from '$lib/sequencer/sampleLibrary';
	import { KITS, type Kit } from '$lib/sequencer/kits';
	import { loadPersistedState, schedulePersist } from '$lib/sequencer/persistence';

	const engine = new SequencerEngine();
	let ready = $state(false);
	let loading = $state(false);

	let activeOverlay: { rowId: string; kind: OverlayKind } | null = $state(null);

	// Lets a tablet held in portrait opt into the landscape (16-across) row
	// layout instead of the cramped 4x4 stack meant for phones; orientation
	// still rotates normally, this just overrides the layout it picks. Tucked
	// behind the logo's settings overlay rather than the header itself, since
	// the header has no room to spare in phone portrait.
	const FORCE_WIDE_KEY = 'efdp-force-wide-layout';
	let forceWide = $state(browser ? localStorage.getItem(FORCE_WIDE_KEY) === 'true' : false);
	let settingsOpen = $state(false);

	function onForceWideChange(e: Event & { currentTarget: HTMLInputElement }) {
		forceWide = e.currentTarget.checked;
		if (browser) localStorage.setItem(FORCE_WIDE_KEY, String(forceWide));
	}

	function navigateOverlay(fromRowId: string, kind: OverlayKind, direction: 1 | -1) {
		const ids = engine.rows.map((voice) => voice.row.id);
		const currentIndex = ids.indexOf(fromRowId);
		const nextIndex = (currentIndex + direction + ids.length) % ids.length;
		activeOverlay = { rowId: ids[nextIndex], kind };
	}

	// Restores a previous session's rows/bpm from localStorage when there's a
	// validly-shaped, current-version save; otherwise falls back to the
	// default kit, same as a first-ever visit.
	async function ensureLoaded() {
		if (ready || loading) return;
		loading = true;
		const saved = browser ? loadPersistedState() : null;
		if (saved && saved.rows.length > 0) {
			engine.setBpm(saved.bpm);
			const library = await loadSampleLibrary();
			const byId = new Map(library.map((s) => [s.id, s]));
			for (const row of saved.rows) {
				const sample = row.sampleId ? byId.get(row.sampleId) : undefined;
				// A sample that no longer resolves (renamed/removed since the
				// save) comes back as a blank row - silent but keeping its
				// pattern/faders - rather than dropping the row entirely.
				if (sample) {
					await engine.addRow(row, sample.url);
				} else {
					engine.addBlankRow(row);
				}
			}
		} else {
			for (const s of KITS[0].samples) {
				await engine.addRow(
					createRow({ id: s.sampleId, name: s.name, sampleId: s.sampleId }),
					s.url
				);
			}
		}
		ready = true;
		loading = false;
	}

	onMount(() => {
		ensureLoaded();
	});

	// Autosaves on every change to bpm or any row's own state (pattern,
	// sample, faders, choke group, ...). Gated on `ready` so the incremental
	// row-by-row restore in ensureLoaded() above never overwrites the save
	// it's still in the middle of reading.
	$effect(() => {
		if (!ready) return;
		schedulePersist(engine.bpm, engine.snapshotRows());
	});

	async function toggle() {
		await ensureLoaded();
		if (engine.playing) {
			engine.stop();
		} else {
			await engine.start();
		}
	}

	const MIN_BPM = 40;
	const MAX_BPM = 300;

	function onBpmInput(e: Event & { currentTarget: HTMLInputElement }) {
		const value = e.currentTarget.valueAsNumber;
		if (!Number.isNaN(value)) engine.setBpm(value);
	}

	function adjustBpm(delta: number) {
		const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, engine.bpm + delta));
		engine.setBpm(clamped);
	}

	// Mirrors SequencerRow's hold-to-remove pattern: clearing wipes every row's
	// grid/velocity/iteration/faders, so it needs the same guard against a
	// stray tap triggering it.
	const CLEAR_HOLD_MS = 1000;
	let clearHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let clearing = $state(false);

	function beginClearHold() {
		clearing = true;
		clearHoldTimer = setTimeout(() => {
			clearHoldTimer = null;
			clearing = false;
			engine.clearAll();
		}, CLEAR_HOLD_MS);
	}

	function cancelClearHold() {
		clearing = false;
		if (clearHoldTimer !== null) {
			clearTimeout(clearHoldTimer);
			clearHoldTimer = null;
		}
	}

	// A brand new row starts with no sample loaded, and its sample overlay is
	// opened immediately so the user picks one right away rather than seeing
	// a silent, unlabeled row sit in the list.
	function addRow() {
		if (engine.playing) return;
		const id = crypto.randomUUID();
		engine.addBlankRow(createRow({ id, name: 'New Row', sampleId: '' }));
		activeOverlay = { rowId: id, kind: 'sample' };
	}

	async function chooseSample(rowId: string, sample: SampleEntry) {
		await engine.setRowSample(rowId, sample.id, sample.label, sample.url);
	}

	function removeRow(rowId: string) {
		engine.removeRow(rowId);
		if (activeOverlay?.rowId === rowId) activeOverlay = null;
	}

	// Applies a kit positionally — kit sample N replaces row N's sample,
	// leaving the row's pattern/faders/choke group untouched. Rows beyond the
	// kit's length are left alone.
	async function loadKit(kit: Kit) {
		if (engine.playing) return;
		await Promise.all(
			kit.samples.map((sample, index) => {
				const voice = engine.rows[index];
				return voice
					? engine.setRowSample(voice.row.id, sample.sampleId, sample.name, sample.url)
					: undefined;
			})
		);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && settingsOpen) settingsOpen = false;
	}}
/>

<div class="page" class:force-wide={forceWide}>
	<div class="header">
		<img class="logo" src={asset('/img/neonquaver.png')} alt="EFDP Sequencer" />
		<button
			class="transport"
			onclick={toggle}
			disabled={loading}
			aria-label={loading ? 'Loading' : engine.playing ? 'Stop' : 'Play'}
		>
			{#if loading}
				Loading…
			{:else}
				{engine.playing ? '■' : '▶'}
			{/if}
		</button>
		<div class="bpm-control">
			<button
				type="button"
				class="bpm-step"
				onclick={() => adjustBpm(-10)}
				aria-label="Decrease tempo by 10"
			>
				-10
			</button>
			<button
				type="button"
				class="bpm-step"
				onclick={() => adjustBpm(-1)}
				aria-label="Decrease tempo by 1"
			>
				-1
			</button>
			<input
				type="number"
				class="bpm-input"
				min={MIN_BPM}
				max={MAX_BPM}
				step="1"
				value={engine.bpm}
				oninput={onBpmInput}
				aria-label="Tempo in beats per minute"
			/>
			<button
				type="button"
				class="bpm-step"
				onclick={() => adjustBpm(1)}
				aria-label="Increase tempo by 1"
			>
				+1
			</button>
			<button
				type="button"
				class="bpm-step"
				onclick={() => adjustBpm(10)}
				aria-label="Increase tempo by 10"
			>
				+10
			</button>
			<span class="bpm-label">BPM</span>
		</div>
	</div>

	<div class="toolbar">
		<button
			type="button"
			class="cog-btn"
			aria-label="Open settings"
			onclick={() => (settingsOpen = true)}
		>
			⚙
		</button>
		<button
			type="button"
			class="clear-btn"
			class:holding={clearing}
			aria-label="Hold to clear grid"
			onpointerdown={beginClearHold}
			onpointerup={cancelClearHold}
			onpointerleave={cancelClearHold}
			onpointercancel={cancelClearHold}
		>
			<span class="clear-btn-fill"></span>
			<span class="clear-btn-icon">🧹</span>
		</button>
	</div>

	<div class="rows">
		{#each engine.rows as voice (voice.row.id)}
			<SequencerRow
				row={voice.row}
				currentStep={engine.currentSteps[voice.row.id] ?? -1}
				openOverlay={activeOverlay?.rowId === voice.row.id ? activeOverlay.kind : null}
				onOverlayChange={(kind) => (activeOverlay = kind ? { rowId: voice.row.id, kind } : null)}
				onNavigateOverlay={(direction) =>
					activeOverlay && navigateOverlay(voice.row.id, activeOverlay.kind, direction)}
				onChooseSample={(sample) => chooseSample(voice.row.id, sample)}
				onRemoveRow={() => removeRow(voice.row.id)}
			/>
		{/each}

		<button
			type="button"
			class="add-row"
			disabled={engine.playing}
			aria-label="Add row"
			onclick={addRow}
		>
			+
		</button>
	</div>

	{#if settingsOpen}
		<div class="overlay" role="dialog" aria-modal="true" aria-label="Settings">
			<div class="overlay-panel bounded-panel">
				<header>
					<h2>Settings</h2>
					<button
						type="button"
						class="close-btn"
						aria-label="Close settings"
						onclick={() => (settingsOpen = false)}
					>
						✕
					</button>
				</header>

				<label class="wide-toggle">
					<input type="checkbox" checked={forceWide} onchange={onForceWideChange} />
					Wide layout
				</label>

				<section class="kits">
					<h3>Kits</h3>
					<div class="kit-list">
						{#each KITS as kit (kit.id)}
							<button
								type="button"
								class="kit-btn"
								disabled={engine.playing}
								onclick={() => loadKit(kit)}
							>
								{kit.name}
							</button>
						{/each}
					</div>
				</section>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.page.force-wide {
		max-width: none;
	}

	/* width:100% is required here (unlike on .page): as a flex item, an auto
	   cross-axis margin disables the default stretch sizing and this would
	   otherwise shrink to fit its content instead of filling then clamping. */
	.bounded-panel {
		width: 100%;
		max-width: 60rem;
		margin: 0 auto;
	}

	.force-wide .bounded-panel {
		max-width: none;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.logo {
		flex-shrink: 0;
		width: auto;
		height: 2.5rem;
	}

	.transport {
		width: 6rem;
		height: 2.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	.transport:disabled {
		opacity: 0.5;
	}

	.bpm-control {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.bpm-input {
		width: 3.5rem;
		height: 2.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		text-align: center;
		font-size: 0.9rem;
	}

	.bpm-step {
		width: 2.25rem;
		height: 2.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.bpm-step:hover {
		background: var(--color-surface);
	}

	.bpm-label {
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.toolbar {
		margin-top: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cog-btn {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 1rem;
	}

	.cog-btn:hover {
		background: var(--color-surface);
	}

	/* Hold-to-confirm fill, same pattern as SequencerRow's remove button, so a
	   stray tap can't wipe every row's grid and faders. */
	.clear-btn {
		position: relative;
		overflow: hidden;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-danger, #b8433a);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 1rem;
	}

	.clear-btn-fill {
		position: absolute;
		inset: 0;
		width: 0%;
		background: var(--color-danger, #b8433a);
		pointer-events: none;
	}

	.clear-btn.holding .clear-btn-fill {
		width: 100%;
		transition: width 1s linear;
	}

	.clear-btn-icon {
		position: relative;
		z-index: 1;
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: var(--color-bg);
		color: var(--color-text);
		display: flex;
		flex-direction: column;
	}

	.overlay-panel {
		flex: 1;
		padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
			max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
		overflow-y: auto;
	}

	.overlay-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.close-btn {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 1rem;
	}

	.wide-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		color: var(--color-text);
	}

	.wide-toggle input {
		width: 1.25rem;
		height: 1.25rem;
	}

	.kits {
		margin-top: 1.5rem;
	}

	.kits h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
		color: var(--color-text);
	}

	.kit-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.kit-btn {
		height: 2.25rem;
		padding: 0 1rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.kit-btn:disabled {
		opacity: 0.5;
	}

	.kit-btn:not(:disabled):hover {
		background: var(--color-surface);
	}

	.rows {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.add-row {
		align-self: flex-start;
		width: 4.5rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 1rem;
		line-height: 1;
	}

	.add-row:disabled {
		opacity: 0.5;
	}

	.add-row:not(:disabled):hover {
		background: var(--color-surface);
	}
</style>
