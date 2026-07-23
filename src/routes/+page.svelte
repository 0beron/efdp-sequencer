<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { asset } from '$app/paths';
	import { SequencerEngine } from '$lib/sequencer/engine.svelte';
	import { createRow } from '$lib/sequencer/types';
	import SequencerRow, { type OverlayKind } from '$lib/components/SequencerRow.svelte';
	import type { SampleEntry } from '$lib/sequencer/sampleLibrary';

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

	async function ensureLoaded() {
		if (ready || loading) return;
		loading = true;
		await engine.addRow(
			createRow({ id: 'kick', name: 'Kick', sampleId: 'kick' }),
			asset('/samples/kick.wav')
		);
		await engine.addRow(
			createRow({ id: 'snare', name: 'Snare', sampleId: 'snare' }),
			asset('/samples/snare.wav')
		);
		await engine.addRow(
			createRow({ id: 'ch', name: 'Closed HH', sampleId: 'ch' }),
			asset('/samples/ch.wav')
		);
		await engine.addRow(
			createRow({ id: 'oh', name: 'Open HH', sampleId: 'oh' }),
			asset('/samples/oh.wav')
		);
		await engine.addRow(
			createRow({ id: 'clap', name: 'Clap', sampleId: 'clap' }),
			asset('/samples/clap.wav')
		);
		await engine.addRow(
			createRow({ id: 'shaker', name: 'Shaker', sampleId: 'shaker' }),
			asset('/samples/shaker.wav')
		);
		await engine.addRow(
			createRow({ id: 'cowbell', name: 'Cowbell', sampleId: 'cowbell' }),
			asset('/samples/cowbell.wav')
		);
		await engine.addRow(
			createRow({ id: 'crash', name: 'Crash', sampleId: 'crash' }),
			asset('/samples/crash.wav')
		);
		ready = true;
		loading = false;
	}

	onMount(() => {
		ensureLoaded();
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
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && settingsOpen) settingsOpen = false;
	}}
/>

<div class="page" class:force-wide={forceWide}>
	<div class="header">
		<button
			type="button"
			class="logo-btn"
			aria-label="Open settings"
			onclick={() => (settingsOpen = true)}
		>
			<img class="logo" src={asset('/img/neonquaver.png')} alt="EFDP Sequencer" />
		</button>
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

	.logo-btn {
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		line-height: 0;
	}

	.logo {
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
