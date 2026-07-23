<script lang="ts">
	import type { Row } from '$lib/sequencer/types';
	import Fader from '$lib/components/Fader.svelte';
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
		openOverlay = null,
		onOverlayChange,
		onNavigateOverlay,
		onChooseSample,
		onRemoveRow
	}: {
		row: Row;
		currentStep?: number;
		openOverlay?: OverlayKind | null;
		onOverlayChange?: (kind: OverlayKind | null) => void;
		onNavigateOverlay?: (direction: 1 | -1) => void;
		onChooseSample?: (sample: SampleEntry) => Promise<void> | void;
		onRemoveRow?: () => void;
	} = $props();

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

	async function chooseSample(sample: SampleEntry) {
		await onChooseSample?.(sample);
		setOverlay(null);
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
		onclick={() => setOverlay('settings')}
	>
		{row.name}
	</button>

	<div class="steps">
		{#each Array.from({ length: row.length }) as _, step (step)}
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
									class="control-btn"
									aria-label={`Shorten ${row.name} by one step`}
									disabled={row.length <= 1}
									onclick={shorten}
								>
									←
								</button>
								<span class="stepper-value">{row.length}</span>
								<button
									type="button"
									class="control-btn"
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
									class="control-btn"
									aria-label={`Decrease ${row.name} choke group`}
									disabled={row.chokeGroup <= 0}
									onclick={() => setChokeGroup(row, row.chokeGroup - 1)}
								>
									−
								</button>
								<span class="stepper-value">{row.chokeGroup === 0 ? 'None' : row.chokeGroup}</span>
								<button
									type="button"
									class="control-btn"
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
								onChange={(v) => setGain(row, v)}
								displayValue={`${Math.round(row.gain * 100)}%`}
							/>

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

						<div class="fader-row">
							<Fader
								label="Lo Cutoff"
								ariaLabel={`${row.name} low pass cutoff`}
								value={row.lowpassCutoff}
								onChange={(v) => setLowpassCutoff(row, v)}
								displayValue={formatFrequency(normalizedToFilterFrequency(row.lowpassCutoff))}
							/>

							<Fader
								label="Lo Reso"
								ariaLabel={`${row.name} low pass resonance`}
								value={row.lowpassResonance}
								onChange={(v) => setLowpassResonance(row, v)}
								displayValue={normalizedToFilterQ(row.lowpassResonance).toFixed(1)}
							/>

							<Fader
								label="Hi Cutoff"
								ariaLabel={`${row.name} high pass cutoff`}
								value={row.highpassCutoff}
								onChange={(v) => setHighpassCutoff(row, v)}
								displayValue={formatFrequency(normalizedToFilterFrequency(row.highpassCutoff))}
							/>

							<Fader
								label="Hi Reso"
								ariaLabel={`${row.name} high pass resonance`}
								value={row.highpassResonance}
								onChange={(v) => setHighpassResonance(row, v)}
								displayValue={normalizedToFilterQ(row.highpassResonance).toFixed(1)}
							/>
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
					<button
						type="button"
						class="close-btn"
						aria-label="Close sample picker"
						onclick={() => setOverlay(null)}
					>
						✕
					</button>
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
					<button
						type="button"
						class="close-btn"
						aria-label="Close velocity"
						onclick={() => setOverlay(null)}
					>
						✕
					</button>
				</header>

				<div class="step-grid">
					{#each Array.from({ length: row.length }) as _, step (step)}
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
					<button
						type="button"
						class="close-btn"
						aria-label="Close probability"
						onclick={() => setOverlay(null)}
					>
						✕
					</button>
				</header>

				<div class="step-grid">
					{#each Array.from({ length: row.length }) as _, step (step)}
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
					<button
						type="button"
						class="close-btn"
						aria-label="Close iteration"
						onclick={() => setOverlay(null)}
					>
						✕
					</button>
				</header>

				<div class="step-grid">
					{#each Array.from({ length: row.length }) as _, step (step)}
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

	.steps {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.35rem;
	}

	@media (orientation: landscape) {
		.steps {
			grid-template-columns: repeat(16, 1fr);
		}
	}

	/* Manual override so a tablet held in portrait can still opt into the
	   16-across landscape layout instead of the cramped-for-nothing 4x4
	   stack — orientation itself still rotates normally, this just widens
	   the grid regardless of it. Kept in sync with the landscape query above. */
	:global(.force-wide) .steps {
		grid-template-columns: repeat(16, 1fr);
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
		grid-template-columns: repeat(4, 1fr);
		grid-auto-rows: 1fr;
		gap: 0.5rem;
	}

	@media (orientation: landscape) {
		.step-grid {
			grid-template-columns: repeat(16, 1fr);
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
		grid-template-columns: repeat(16, 1fr);
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
		flex-shrink: 0;
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
