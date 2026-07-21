<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { SequencerEngine } from '$lib/sequencer/engine.svelte';
	import { createRow } from '$lib/sequencer/types';
	import SequencerRow, { type OverlayKind } from '$lib/components/SequencerRow.svelte';

	const engine = new SequencerEngine();
	let ready = $state(false);
	let loading = $state(false);

	let activeOverlay: { rowId: string; kind: OverlayKind } | null = $state(null);

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

	function onBpmInput(e: Event & { currentTarget: HTMLInputElement }) {
		const value = e.currentTarget.valueAsNumber;
		if (!Number.isNaN(value)) engine.setBpm(value);
	}
</script>

<div class="page">
	<div class="header">
		<img class="logo" src={asset('/img/neonquaver.png')} alt="EFDP Sequencer" />
		<button class="transport" onclick={toggle} disabled={loading}>
			{#if loading}
				Loading…
			{:else}
				{engine.playing ? '■ Stop' : '▶ Play'}
			{/if}
		</button>
		<div class="bpm-control">
			<input
				type="number"
				class="bpm-input"
				min="40"
				max="300"
				step="1"
				value={engine.bpm}
				oninput={onBpmInput}
				aria-label="Tempo in beats per minute"
			/>
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
			/>
		{/each}
	</div>
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
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

	.bpm-label {
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.rows {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
</style>
