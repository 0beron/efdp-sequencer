<script lang="ts">
	import * as Tone from 'tone';
	import { onDestroy } from 'svelte';
	import { loadSampleLibrary, type SampleEntry } from '$lib/sequencer/sampleLibrary';

	let {
		currentSampleId,
		onChoose
	}: {
		currentSampleId: string;
		onChoose: (sample: SampleEntry) => Promise<void> | void;
	} = $props();

	let samples = $state<SampleEntry[]>([]);
	let loading = $state(true);

	loadSampleLibrary().then((list) => {
		samples = list;
		loading = false;
	});

	// A single reusable player for auditioning, rather than one per sample —
	// only one preview ever plays at a time.
	let previewPlayer: Tone.Player | null = null;

	async function playPreview(sample: SampleEntry) {
		await Tone.start();
		if (!previewPlayer) previewPlayer = new Tone.Player().toDestination();
		if (previewPlayer.state === 'started') previewPlayer.stop();
		await previewPlayer.load(sample.url);
		previewPlayer.start();
	}

	function chooseSample(sample: SampleEntry) {
		playPreview(sample);
		onChoose(sample);
	}

	onDestroy(() => {
		previewPlayer?.dispose();
	});
</script>

<div class="sample-picker">
	<div class="sample-list" role="listbox" aria-label="Available samples">
		{#if loading}
			<p class="status">Loading samples…</p>
		{:else if samples.length === 0}
			<p class="status">No samples found in static/samples.</p>
		{:else}
			{#each samples as sample (sample.id)}
				<button
					type="button"
					class="sample-item"
					class:active={currentSampleId === sample.id}
					role="option"
					aria-selected={currentSampleId === sample.id}
					onclick={() => chooseSample(sample)}
				>
					{sample.label}
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.sample-picker {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sample-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		align-content: start;
	}

	@media (orientation: landscape) {
		.sample-list {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	/* Manual override, set by the parent page's "wide layout" checkbox.
	   Kept in sync with the landscape query above. */
	:global(.force-wide) .sample-list {
		grid-template-columns: repeat(4, 1fr);
	}

	.status {
		grid-column: 1 / -1;
	}

	.sample-item {
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		padding: 0.6rem 0.5rem;
		font-size: 0.9rem;
		text-align: center;
	}

	.sample-item.active {
		background: var(--color-accent);
		border-color: var(--color-accent-strong);
	}
</style>
