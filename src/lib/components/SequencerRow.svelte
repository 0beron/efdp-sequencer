<script lang="ts">
	import type { Row } from '$lib/sequencer/types';
	import Fader from '$lib/components/Fader.svelte';
	import EnvelopeGraph from '$lib/components/EnvelopeGraph.svelte';
	import FilterResponseGraph from '$lib/components/FilterResponseGraph.svelte';
	import StepFader from '$lib/components/StepFader.svelte';
	import StepIterationControl from '$lib/components/StepIterationControl.svelte';
	import SamplePicker from '$lib/components/SamplePicker.svelte';
	import type { SampleEntry } from '$lib/sequencer/sampleLibrary';
	import {
		isStepActive,
		toggleTrigger,
		setLength,
		setAttack,
		setDecay,
		setGain,
		setLowpassCutoff,
		setLowpassResonance,
		setHighpassCutoff,
		setHighpassResonance,
		setChokeGroup,
		normalizedToFilterFrequency,
		normalizedToFilterQ,
		getVelocity,
		setVelocity,
		getProbability,
		setProbability,
		getIterationN,
		setIterationN,
		getIterationM,
		setIterationM,
		MAX_ATTACK_SECONDS,
		MAX_DECAY_SECONDS
	} from '$lib/sequencer/types';

	export type OverlayKind = 'settings' | 'sample' | 'velocity' | 'probability' | 'iteration';

	let {
		row,
		currentStep = -1,
		gridMarkerEvery = 4,
		pageOffset = 0,
		stepsPerPage = 16,
		currentPage = 0,
		pageCount = 1,
		openOverlay = null,
		defaultOverlayKind = 'settings',
		onOverlayChange,
		onNavigateOverlay,
		onChangePage,
		onChooseSample,
		onRemoveRow,
		onSoundChange
	}: {
		row: Row;
		currentStep?: number;
		gridMarkerEvery?: number;
		// Absolute step index the currently-viewed page starts at, and how many
		// steps a page holds - both owned by the parent page so every row's
		// grid stays in lockstep on the same page.
		pageOffset?: number;
		stepsPerPage?: number;
		// Which page is currently showing and how many pages exist - same
		// parent-owned page state as pageOffset/stepsPerPage, surfaced here so
		// the overlay header can offer its own compact page nav without every
		// row losing sync with the main page controls.
		currentPage?: number;
		pageCount?: number;
		openOverlay?: OverlayKind | null;
		// Which overlay page to land on when opening from closed (e.g. clicking
		// the row name) - owned by the parent so it can remember the last page
		// viewed across every row, not just this one.
		defaultOverlayKind?: OverlayKind;
		onOverlayChange?: (kind: OverlayKind | null) => void;
		onNavigateOverlay?: (direction: 1 | -1) => void;
		onChangePage?: (direction: 1 | -1) => void;
		onChooseSample?: (sample: SampleEntry) => Promise<void> | void;
		onRemoveRow?: () => void;
		// Called after a filter/gain fader changes so the engine can push it to
		// the row's live audio nodes immediately, instead of leaving it to sit
		// unheard until the row's next trigger.
		onSoundChange?: () => void;
	} = $props();

	// How many of this page's slots the row actually has steps for - a row
	// shorter than the current page's range (or entirely past it) just
	// renders fewer/zero cells, same convention as a short row already using
	// fewer than the grid's full column count today.
	let visibleStepCount = $derived(Math.max(0, Math.min(stepsPerPage, row.length - pageOffset)));

	// Caps each breakpoint's grid column count at the page size, so a page
	// smaller than the breakpoint's natural width (e.g. an 8-step page in the
	// 16-wide landscape layout) fills cleanly instead of leaving the unused
	// columns as a permanent blank gap. Portrait wraps at gridMarkerEvery
	// itself (falling back to 4 if markers are off) rather than a fixed 4, so
	// the pad grid's row breaks always land exactly on a marker line instead
	// of the two drifting apart.
	let narrowCols = $derived(
		Math.max(1, Math.min(gridMarkerEvery > 0 ? gridMarkerEvery : 4, stepsPerPage))
	);
	let wideCols = $derived(Math.max(1, Math.min(16, stepsPerPage)));
	// How many rows the pad grid itself wraps into at each breakpoint, so the
	// marker overlay grid below can mirror that row count and give each
	// marker line a single row-tall cell instead of stretching the full
	// (possibly multi-row) grid height.
	let narrowRows = $derived(Math.max(1, Math.ceil(visibleStepCount / narrowCols)));
	let wideRows = $derived(Math.max(1, Math.ceil(visibleStepCount / wideCols)));
	let colsStyle = $derived(
		`--narrow-cols: ${narrowCols}; --wide-cols: ${wideCols}; --narrow-rows: ${narrowRows}; --wide-rows: ${wideRows}`
	);

	// One marker per interior group boundary - every `gridMarkerEvery` steps
	// *absolute* across the whole row, but not before the very first pad of
	// the page (that edge doesn't need a divider) and never past the row's
	// own length. Positions are page-local (0-based within the current page)
	// since the grid itself always starts at column 1 for whichever page is
	// showing; with pageOffset 0 this is identical to marking every absolute
	// multiple of gridMarkerEvery. Each carries both a portrait-grid and
	// landscape-grid row/column, since the pad grid's own column count - and
	// therefore which cell a given boundary falls in - changes at that
	// breakpoint; CSS picks whichever applies via the same media query as
	// .steps below.
	let markerSteps = $derived(
		gridMarkerEvery > 0
			? Array.from({ length: Math.max(0, stepsPerPage - 1) }, (_, i) => i + 1).filter((local) => {
					const abs = pageOffset + local;
					return abs % gridMarkerEvery === 0 && abs < row.length;
				})
			: []
	);

	function setOverlay(kind: OverlayKind | null) {
		onOverlayChange?.(kind);
	}

	const REMOVE_HOLD_MS = 1000;
	let removeHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let removing = $state(false);

	function beginRemoveHold() {
		removing = true;
		removeHoldTimer = setTimeout(() => {
			removeHoldTimer = null;
			onRemoveRow?.();
		}, REMOVE_HOLD_MS);
	}

	function cancelRemoveHold() {
		removing = false;
		if (removeHoldTimer !== null) {
			clearTimeout(removeHoldTimer);
			removeHoldTimer = null;
		}
	}

	// Guards against the hold timer surviving a hold that gets interrupted by
	// something other than pointerup/pointerleave, e.g. Escape closing the
	// overlay mid-hold.
	$effect(() => {
		if (openOverlay !== 'settings') cancelRemoveHold();
	});

	function chooseSample(sample: SampleEntry) {
		onChooseSample?.(sample);
	}

	function shorten() {
		if (row.length > 1) setLength(row, row.length - 1);
	}

	function lengthen() {
		setLength(row, row.length + 1);
	}

	// Shrinks the label to fit its fixed-width box instead of wrapping/clipping;
	// scrollWidth still reports the unwrapped text's full extent even though
	// overflow is hidden, so it's a reliable measure of how much we're overflowing by.
	function fitText(node: HTMLElement) {
		const available = node.clientWidth;
		const natural = node.scrollWidth;
		if (available > 0 && natural > available) {
			const base = parseFloat(getComputedStyle(node).fontSize);
			node.style.fontSize = `${Math.max(base * (available / natural), 8)}px`;
		}
	}

	function formatFrequency(hz: number): string {
		return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k Hz` : `${Math.round(hz)} Hz`;
	}

	// Squares velocity so the pad's color intensity ramps up faster at high
	// velocities and stays compressed at low ones, since low velocities are
	// rarely used and don't need much of the color range to stay distinguishable.
	function velocityIntensity(velocity: number): number {
		return velocity ** 2;
	}
</script>

{#snippet overlaySwitcher(current: OverlayKind)}
	<div class="overlay-switcher" role="group" aria-label="Switch overlay">
		<button
			type="button"
			class="switcher-btn"
			class:active={current === 'settings'}
			aria-label={`${row.name} settings`}
			aria-pressed={current === 'settings'}
			onclick={() => setOverlay('settings')}
		>
			⚙
		</button>
		<button
			type="button"
			class="switcher-btn"
			class:active={current === 'sample'}
			aria-label={`${row.name} sample`}
			aria-pressed={current === 'sample'}
			onclick={() => setOverlay('sample')}
		>
			♪
		</button>
		<button
			type="button"
			class="switcher-btn"
			class:active={current === 'velocity'}
			aria-label={`${row.name} velocity`}
			aria-pressed={current === 'velocity'}
			onclick={() => setOverlay('velocity')}
		>
			V
		</button>
		<button
			type="button"
			class="switcher-btn"
			class:active={current === 'probability'}
			aria-label={`${row.name} probability`}
			aria-pressed={current === 'probability'}
			onclick={() => setOverlay('probability')}
		>
			%
		</button>
		<button
			type="button"
			class="switcher-btn"
			class:active={current === 'iteration'}
			aria-label={`${row.name} iteration`}
			aria-pressed={current === 'iteration'}
			onclick={() => setOverlay('iteration')}
		>
			↻
		</button>
	</div>
{/snippet}

{#snippet overlayNav(direction: 1 | -1)}
	<button
		type="button"
		class="control-btn overlay-nav-btn"
		aria-label={direction === -1
			? `Previous row's ${openOverlay} overlay`
			: `Next row's ${openOverlay} overlay`}
		onclick={() => onNavigateOverlay?.(direction)}
	>
		{direction === -1 ? '←' : '→'}
	</button>
{/snippet}

{#snippet compactPageNav()}
	<div class="compact-page-nav" role="group" aria-label="Page">
		<button
			type="button"
			class="control-btn compact-page-nav-btn"
			disabled={currentPage === 0}
			aria-label="Previous page"
			onclick={() => onChangePage?.(-1)}
		>
			‹
		</button>
		<span class="compact-page-nav-label">Pg {currentPage + 1}/{pageCount}</span>
		<button
			type="button"
			class="control-btn compact-page-nav-btn"
			disabled={currentPage === pageCount - 1}
			aria-label="Next page"
			onclick={() => onChangePage?.(1)}
		>
			›
		</button>
	</div>
{/snippet}

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') return;
		if (openOverlay) setOverlay(null);
	}}
/>

<div class="row">
	<button
		type="button"
		class="row-name"
		use:fitText
		aria-label={`${row.name} settings`}
		onclick={() => setOverlay(defaultOverlayKind)}
	>
		{row.name}
	</button>

	<div class="steps-wrap" style={colsStyle}>
		<div class="step-markers" aria-hidden="true">
			{#each markerSteps as local (local)}
				<span
					class="step-marker"
					style={`--col-narrow: ${(local % narrowCols) + 1}; --row-narrow: ${Math.floor(local / narrowCols) + 1}; --col-wide: ${(local % wideCols) + 1}; --row-wide: ${Math.floor(local / wideCols) + 1}`}
				></span>
			{/each}
		</div>
		<div class="steps">
			{#each Array.from({ length: visibleStepCount }) as _, i (pageOffset + i)}
				{@const step = pageOffset + i}
				<button
					type="button"
					class="step"
					class:active={isStepActive(row, step)}
					class:playing={currentStep === step}
					style={isStepActive(row, step)
						? `--velocity: ${velocityIntensity(getVelocity(row, step))}`
						: undefined}
					aria-pressed={isStepActive(row, step)}
					aria-label={`${row.name} step ${step + 1}`}
					onclick={() => toggleTrigger(row, step)}
				></button>
			{/each}
		</div>
	</div>
</div>

{#if openOverlay === 'settings'}
	<div class="overlay" role="dialog" aria-modal="true" aria-label={`${row.name} settings`}>
		<div class="overlay-panel bounded-panel">
			{@render overlaySwitcher('settings')}

			<div class="overlay-content">
				<header>
					<div class="header-title">
						{@render overlayNav(-1)}
						<h2>{row.name}</h2>
						{@render overlayNav(1)}
					</div>
					<div class="header-actions">
						{@render compactPageNav()}
						<button
							type="button"
							class="remove-btn"
							class:holding={removing}
							aria-label={`Hold to remove ${row.name}`}
							onpointerdown={beginRemoveHold}
							onpointerup={cancelRemoveHold}
							onpointerleave={cancelRemoveHold}
							onpointercancel={cancelRemoveHold}
						>
							<span class="remove-btn-fill"></span>
							<span class="remove-btn-icon">🗑</span>
						</button>
						<button
							type="button"
							class="close-btn"
							aria-label="Close settings"
							onclick={() => setOverlay(null)}
						>
							✕
						</button>
					</div>
				</header>

				<div class="settings-body">
					<div class="stepper-list">
						<div class="stepper-control">
							<span class="stepper-label">Length</span>
							<div class="stepper-buttons">
								<button
									type="button"
									class="control-btn stepper-btn"
									aria-label={`Shorten ${row.name} by one step`}
									disabled={row.length <= 1}
									onclick={shorten}
								>
									←
								</button>
								<span class="stepper-value">{row.length}</span>
								<button
									type="button"
									class="control-btn stepper-btn"
									aria-label={`Lengthen ${row.name} by one step`}
									onclick={lengthen}
								>
									→
								</button>
							</div>
						</div>

						<div class="stepper-control">
							<span class="stepper-label">Choke Group</span>
							<div class="stepper-buttons">
								<button
									type="button"
									class="control-btn stepper-btn"
									aria-label={`Decrease ${row.name} choke group`}
									disabled={row.chokeGroup <= 0}
									onclick={() => setChokeGroup(row, row.chokeGroup - 1)}
								>
									−
								</button>
								<span class="stepper-value">{row.chokeGroup === 0 ? 'None' : row.chokeGroup}</span>
								<button
									type="button"
									class="control-btn stepper-btn"
									aria-label={`Increase ${row.name} choke group`}
									onclick={() => setChokeGroup(row, row.chokeGroup + 1)}
								>
									+
								</button>
							</div>
						</div>
					</div>

					<div class="controls-section">
						<div class="fader-row">
							<Fader
								label="Volume"
								ariaLabel={`${row.name} volume`}
								value={row.gain}
								onChange={(v) => {
									setGain(row, v);
									onSoundChange?.();
								}}
								displayValue={`${Math.round(row.gain * 100)}%`}
							/>

							<div class="envelope-group">
								<EnvelopeGraph attack={row.attack} decay={row.decay} />
								<div class="envelope-faders">
									<Fader
										label="Attack"
										ariaLabel={`${row.name} attack`}
										value={row.attack}
										onChange={(v) => setAttack(row, v)}
										displayValue={`${Math.round(row.attack * MAX_ATTACK_SECONDS * 1000)} ms`}
									/>

									<Fader
										label="Decay"
										ariaLabel={`${row.name} decay`}
										value={row.decay}
										onChange={(v) => setDecay(row, v)}
										displayValue={row.decay >= 1
											? 'MAX'
											: `${Math.round(row.decay * MAX_DECAY_SECONDS * 1000)} ms`}
									/>
								</div>
							</div>
						</div>

						<div class="filter-group">
							<FilterResponseGraph
								lowpassCutoff={row.lowpassCutoff}
								lowpassResonance={row.lowpassResonance}
								highpassCutoff={row.highpassCutoff}
								highpassResonance={row.highpassResonance}
							/>
							<div class="filter-faders">
								<Fader
									label="Lo Cutoff"
									ariaLabel={`${row.name} low pass cutoff`}
									value={row.lowpassCutoff}
									onChange={(v) => {
										setLowpassCutoff(row, v);
										onSoundChange?.();
									}}
									displayValue={formatFrequency(normalizedToFilterFrequency(row.lowpassCutoff))}
								/>

								<Fader
									label="Lo Reso"
									ariaLabel={`${row.name} low pass resonance`}
									value={row.lowpassResonance}
									onChange={(v) => {
										setLowpassResonance(row, v);
										onSoundChange?.();
									}}
									displayValue={normalizedToFilterQ(row.lowpassResonance).toFixed(1)}
								/>

								<Fader
									label="Hi Cutoff"
									ariaLabel={`${row.name} high pass cutoff`}
									value={row.highpassCutoff}
									onChange={(v) => {
										setHighpassCutoff(row, v);
										onSoundChange?.();
									}}
									displayValue={formatFrequency(normalizedToFilterFrequency(row.highpassCutoff))}
									invertFill
								/>

								<Fader
									label="Hi Reso"
									ariaLabel={`${row.name} high pass resonance`}
									value={row.highpassResonance}
									onChange={(v) => {
										setHighpassResonance(row, v);
										onSoundChange?.();
									}}
									displayValue={normalizedToFilterQ(row.highpassResonance).toFixed(1)}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if openOverlay === 'sample'}
	<div class="overlay" role="dialog" aria-modal="true" aria-label={`${row.name} sample`}>
		<div class="overlay-panel bounded-panel">
			{@render overlaySwitcher('sample')}

			<div class="overlay-content">
				<header>
					<div class="header-title">
						{@render overlayNav(-1)}
						<h2>{row.name} Sample</h2>
						{@render overlayNav(1)}
					</div>
					<div class="header-actions">
						{@render compactPageNav()}
						<button
							type="button"
							class="close-btn"
							aria-label="Close sample picker"
							onclick={() => setOverlay(null)}
						>
							✕
						</button>
					</div>
				</header>

				<SamplePicker currentSampleId={row.sampleId} onChoose={chooseSample} />
			</div>
		</div>
	</div>
{/if}

{#if openOverlay === 'velocity'}
	<div
		class="overlay step-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={`${row.name} velocity`}
	>
		<div class="overlay-panel bounded-panel">
			{@render overlaySwitcher('velocity')}

			<div class="overlay-content">
				<header>
					<div class="header-title">
						{@render overlayNav(-1)}
						<h2>{row.name} Velocity</h2>
						{@render overlayNav(1)}
					</div>
					<div class="header-actions">
						{@render compactPageNav()}
						<button
							type="button"
							class="close-btn"
							aria-label="Close velocity"
							onclick={() => setOverlay(null)}
						>
							✕
						</button>
					</div>
				</header>

				<div class="step-grid" style={colsStyle}>
					{#each Array.from({ length: visibleStepCount }) as _, i (pageOffset + i)}
						{@const step = pageOffset + i}
						{#if isStepActive(row, step)}
							<StepFader
								value={getVelocity(row, step)}
								onChange={(v) => setVelocity(row, step, v)}
								ariaLabel={`${row.name} step ${step + 1} velocity`}
							/>
						{:else}
							<div class="step-fader-spacer" aria-hidden="true"></div>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

{#if openOverlay === 'probability'}
	<div
		class="overlay step-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={`${row.name} probability`}
	>
		<div class="overlay-panel bounded-panel">
			{@render overlaySwitcher('probability')}

			<div class="overlay-content">
				<header>
					<div class="header-title">
						{@render overlayNav(-1)}
						<h2>{row.name} Probability</h2>
						{@render overlayNav(1)}
					</div>
					<div class="header-actions">
						{@render compactPageNav()}
						<button
							type="button"
							class="close-btn"
							aria-label="Close probability"
							onclick={() => setOverlay(null)}
						>
							✕
						</button>
					</div>
				</header>

				<div class="step-grid" style={colsStyle}>
					{#each Array.from({ length: visibleStepCount }) as _, i (pageOffset + i)}
						{@const step = pageOffset + i}
						{#if isStepActive(row, step)}
							<StepFader
								value={getProbability(row, step)}
								onChange={(v) => setProbability(row, step, v)}
								ariaLabel={`${row.name} step ${step + 1} probability`}
							/>
						{:else}
							<div class="step-fader-spacer" aria-hidden="true"></div>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

{#if openOverlay === 'iteration'}
	<div
		class="overlay step-overlay"
		role="dialog"
		aria-modal="true"
		aria-label={`${row.name} iteration`}
	>
		<div class="overlay-panel bounded-panel">
			{@render overlaySwitcher('iteration')}

			<div class="overlay-content">
				<header>
					<div class="header-title">
						{@render overlayNav(-1)}
						<h2>{row.name} Iteration</h2>
						{@render overlayNav(1)}
					</div>
					<div class="header-actions">
						{@render compactPageNav()}
						<button
							type="button"
							class="close-btn"
							aria-label="Close iteration"
							onclick={() => setOverlay(null)}
						>
							✕
						</button>
					</div>
				</header>

				<div class="step-grid" style={colsStyle}>
					{#each Array.from({ length: visibleStepCount }) as _, i (pageOffset + i)}
						{@const step = pageOffset + i}
						{#if isStepActive(row, step)}
							<StepIterationControl
								n={getIterationN(row, step)}
								m={getIterationM(row, step)}
								onChangeN={(v) => setIterationN(row, step, v)}
								onChangeM={(v) => setIterationM(row, step, v)}
								label={`${row.name} step ${step + 1}`}
							/>
						{:else}
							<div class="step-fader-spacer" aria-hidden="true"></div>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.control-btn {
		width: 1rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
		line-height: 1;
		padding: 0;
	}

	.control-btn:disabled {
		opacity: 0.35;
	}

	/* Wider than the base .control-btn (used as-is by the row-nav and compact
	   page-nav arrows above) - these are the Length/Choke Group +/- steppers,
	   pressed often enough to deserve a bigger, easier-to-hit target, in line
	   with the wide page-nav buttons in +page.svelte. */
	.stepper-btn {
		width: 2.25rem;
	}

	.row-name {
		width: 4.5rem;
		height: 1.75rem;
		flex-shrink: 0;
		overflow: hidden;
		white-space: nowrap;
		text-align: center;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		padding: 0.25rem 0.4rem;
		font-size: 0.9rem;
	}

	.steps-wrap {
		flex: 1;
		min-width: 0;
		position: relative;
	}

	.steps {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(var(--narrow-cols, 4), 1fr);
		gap: 0.35rem;
	}

	@media (orientation: landscape) {
		.steps {
			grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
		}
	}

	/* Manual override so a tablet held in portrait can still opt into the
	   16-across landscape layout instead of the cramped-for-nothing 4x4
	   stack — orientation itself still rotates normally, this just widens
	   the grid regardless of it. Kept in sync with the landscape query above. */
	:global(.force-wide) .steps {
		grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
	}

	/* Purely decorative grid-line dividers, laid out in their own grid (not
	   mixed into .steps) so they can be placed on exact column lines without
	   fighting the pads' own auto-placement. Mirrors .steps' column *and* row
	   count/gap at each breakpoint, so each marker's cell lines up exactly
	   with the pad row it belongs to instead of stretching across every row
	   the pads wrap into. */
	.step-markers {
		position: absolute;
		inset: 0;
		z-index: 0;
		display: grid;
		grid-template-columns: repeat(var(--narrow-cols, 4), 1fr);
		grid-template-rows: repeat(var(--narrow-rows, 1), 1fr);
		gap: 0.35rem;
		pointer-events: none;
	}

	@media (orientation: landscape) {
		.step-markers {
			grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
			grid-template-rows: repeat(var(--wide-rows, 1), 1fr);
		}
	}

	:global(.force-wide) .step-markers {
		grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
		grid-template-rows: repeat(var(--wide-rows, 1), 1fr);
	}

	/* --col-narrow/--row-narrow (and their -wide counterparts) are set per-
	   marker from markerSteps; whichever pair applies at the current
	   breakpoint mirrors .steps' own column switch above, confining the line
	   to a single pad-tall cell. justify-self:start plants the marker's left
	   edge on the grid line itself (the boundary between the gap and this
	   column); shifting left by half its own width plus half the gap
	   (matching .steps' gap above) centers it in the gap instead of hugging
	   the pad that follows. */
	.step-marker {
		grid-row: var(--row-narrow, 1);
		grid-column: var(--col-narrow);
		justify-self: start;
		width: 2px;
		height: 100%;
		background: var(--color-border);
		transform: translateX(calc(-50% - 0.175rem));
	}

	@media (orientation: landscape) {
		.step-marker {
			grid-row: var(--row-wide, 1);
			grid-column: var(--col-wide);
		}
	}

	:global(.force-wide) .step-marker {
		grid-row: var(--row-wide, 1);
		grid-column: var(--col-wide);
	}

	.step {
		width: 100%;
		min-width: 0;
		aspect-ratio: 1;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		padding: 0;
	}

	.step.active {
		/* --velocity (0..1) blends the accent color toward the surface color so
		   quieter steps read as visibly dimmer pads, not just same-color-different-volume. */
		background: color-mix(
			in srgb,
			var(--color-accent) calc(15% + var(--velocity, 1) * 85%),
			var(--color-surface)
		);
		border-color: var(--color-accent-strong);
	}

	.step.playing {
		outline: 2px solid var(--color-highlight);
		outline-offset: 1px;
	}

	/* Matches .page's own max-width/centering so the overlay's content area
	   lines up with the row it edits (for the step overlays) and never grows
	   wide enough to force the settings overlay's faders into horizontal
	   scrolling. width:100% is required here (unlike on .page): as a flex
	   item, an auto cross-axis margin disables the default stretch sizing and
	   this would otherwise shrink to fit its content instead of filling then
	   clamping. */
	.bounded-panel {
		width: 100%;
		max-width: 60rem;
		margin: 0 auto;
	}

	/* Matches .page's own force-wide override so the overlay keeps lining up
	   with the row grid when wide layout is on. */
	:global(.force-wide) .bounded-panel {
		max-width: none;
	}

	.step-grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(var(--narrow-cols, 4), 1fr);
		grid-auto-rows: 1fr;
		gap: 0.5rem;
	}

	@media (orientation: landscape) {
		.step-grid {
			grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
			/* Left offset of .steps within .row (5rem: row-name 4.5rem + one
			   0.5rem row gap), minus the overlay-switcher's own footprint
			   (1.75rem button + 0.5rem gap) since the switcher sits to the left
			   of .overlay-content and already accounts for that much of the
			   offset. */
			padding-left: 2.75rem;
			gap: 0.35rem;
		}
	}

	/* See the .steps override above. */
	:global(.force-wide) .step-grid {
		grid-template-columns: repeat(var(--wide-cols, 16), 1fr);
		padding-left: 2.75rem;
		gap: 0.35rem;
	}

	.step-fader-spacer {
		min-width: 0;
		min-height: 0;
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

	/* Left translucent so the row's own step grid stays visible underneath,
	   reinforcing that the faders above line up with those pads. */
	.step-overlay {
		background: color-mix(in srgb, var(--color-bg) 68%, transparent);
	}

	.overlay-panel {
		flex: 1;
		display: flex;
		flex-direction: row;
		align-items: stretch;
		gap: 0.5rem;
		padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
			max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
		overflow-y: auto;
	}

	/* Fixed-width sidebar so it never eats into the content column's width -
	   the step-grid's landscape padding-left above is computed assuming this
	   stays exactly button-width (1.75rem) + the panel's 0.5rem gap. */
	.overlay-switcher {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.switcher-btn {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
		line-height: 1;
		padding: 0;
	}

	.switcher-btn.active {
		background: var(--color-accent);
		border-color: var(--color-accent-strong);
	}

	.overlay-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.overlay-content header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.header-title {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}

	.overlay-nav-btn {
		flex-shrink: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.compact-page-nav {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.compact-page-nav-btn {
		width: 1.75rem;
		height: 1.75rem;
		font-size: 0.9rem;
	}

	.compact-page-nav-label {
		min-width: 2.75rem;
		text-align: center;
		font-size: 0.75rem;
		color: var(--color-text);
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

	/* Extra margin (well past the header's other button gaps) plus a hold-to-
	   confirm fill so this destructive action can't be triggered by a stray
	   tap next to the close button. */
	.remove-btn {
		position: relative;
		overflow: hidden;
		width: 2.25rem;
		height: 2.25rem;
		margin-right: 1.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-danger, #b8433a);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 1rem;
	}

	.remove-btn-fill {
		position: absolute;
		inset: 0;
		width: 0%;
		background: var(--color-danger, #b8433a);
		pointer-events: none;
	}

	.remove-btn.holding .remove-btn-fill {
		width: 100%;
		transition: width 1s linear;
	}

	.remove-btn-icon {
		position: relative;
		z-index: 1;
	}

	/* Column layout (steppers above faders) in portrait; landscape moves the
	   steppers into a left-hand column so the faders get the full panel
	   height instead of splitting it with the steppers stacked above them. */
	.settings-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	@media (orientation: landscape) {
		.settings-body {
			flex-direction: row;
			gap: 1.5rem;
		}
	}

	/* See the .steps override above. */
	:global(.force-wide) .settings-body {
		flex-direction: row;
		gap: 1.5rem;
	}

	.stepper-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	@media (orientation: landscape) {
		.stepper-list {
			flex-shrink: 0;
			justify-content: center;
		}
	}

	/* See the .steps override above. */
	:global(.force-wide) .stepper-list {
		flex-shrink: 0;
		justify-content: center;
	}

	/* Label above the buttons (rather than inline) so each stepper is only
	   as wide as its button row, not the label text. Grouped in its own
	   slightly-lighter card so the label reads as attached to its buttons. */
	.stepper-control {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-surface);
	}

	.stepper-label {
		font-size: 0.9rem;
		text-align: center;
	}

	.stepper-buttons {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.stepper-value {
		min-width: 2.5rem;
		text-align: center;
		font-size: 0.9rem;
	}

	.controls-section {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	@media (orientation: landscape) {
		.controls-section {
			flex-direction: row;
			gap: 1.25rem;
		}
	}

	/* See the .steps override above. */
	:global(.force-wide) .controls-section {
		flex-direction: row;
		gap: 1.25rem;
	}

	.fader-row {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 1rem;
		justify-content: center;
	}

	/* Groups the attack/decay pair with their shared envelope diagram above
	   them, so the graph reads as belonging to both faders rather than
	   floating over the whole fader-row (which also holds Volume). */
	.envelope-group {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		height: 100%;
	}

	.envelope-faders {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 1rem;
	}

	/* Takes over the top-level-child role .fader-row otherwise plays directly
	   under .controls-section (equal share in portrait, auto-width side by
	   side in landscape), now that this slot holds a graph above its faders
	   instead of just the faders. */
	.filter-group {
		flex: 1;
		min-height: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
	}

	@media (orientation: landscape) {
		.filter-group {
			flex: 0 1 auto;
		}
	}

	:global(.force-wide) .filter-group {
		flex: 0 1 auto;
	}

	.filter-faders {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 1rem;
		justify-content: center;
	}

	@media (orientation: landscape) {
		.fader-row {
			flex: 0 1 auto;
		}
	}

	/* See the .steps override above. */
	:global(.force-wide) .fader-row {
		flex: 0 1 auto;
	}
</style>
