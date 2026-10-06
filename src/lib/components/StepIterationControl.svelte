<script lang="ts">
	// A pair of narrow vertical steppers (n above m) stacked to fill one
	// step-grid cell, matching StepFader's footprint so the iteration overlay
	// lines up column-for-column with velocity/probability and the row above it.
	let {
		n,
		m,
		onChangeN,
		onChangeM,
		label
	}: {
		n: number;
		m: number;
		onChangeN: (value: number) => void;
		onChangeM: (value: number) => void;
		label: string;
	} = $props();
</script>

<div class="iteration-control">
	<div class="iteration-stepper">
		<button
			type="button"
			class="iteration-btn"
			aria-label={`${label} play-on iteration, increase`}
			onclick={() => onChangeN(n + 1)}
		>
			▲
		</button>
		<span class="iteration-value" aria-label={`${label} plays on iteration ${n} of ${m}`}>
			{n}
		</span>
		<button
			type="button"
			class="iteration-btn"
			aria-label={`${label} play-on iteration, decrease`}
			disabled={n <= 1}
			onclick={() => onChangeN(n - 1)}
		>
			▼
		</button>
	</div>
	<div class="iteration-divider" aria-hidden="true">of</div>
	<div class="iteration-stepper">
		<button
			type="button"
			class="iteration-btn"
			aria-label={`${label} cycle length, increase`}
			onclick={() => onChangeM(m + 1)}
		>
			▲
		</button>
		<span class="iteration-value">{m}</span>
		<button
			type="button"
			class="iteration-btn"
			aria-label={`${label} cycle length, decrease`}
			disabled={m <= 1}
			onclick={() => onChangeM(m - 1)}
		>
			▼
		</button>
	</div>
</div>

<style>
	.iteration-control {
		container-type: inline-size;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: 0.15rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		padding: 0.15rem 0;
	}

	.iteration-stepper {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: center;
		gap: 0.15rem;
	}

	/* flex: 1 1 0 (rather than the old flex: 0 0 auto) lets each button grow to
	   fill its half of the cell's available height instead of sizing to its
	   glyph's line-height - width stays 100% either way, so this only grows
	   the tap target vertically, matching the narrow-column constraint. Their
	   share shrinks as .iteration-value's larger font claims more of the
	   stepper's fixed height, down to min-height - below that the control
	   grows past the grid cell rather than crushing the buttons further. */
	.iteration-btn {
		width: 100%;
		flex: 1 1 0;
		min-height: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-accent-strong);
		border-radius: 0.25rem;
		background: var(--color-accent);
		color: var(--color-bg);
		font-size: 0.65rem;
		line-height: 1;
		padding: 0;
	}

	.iteration-btn:disabled {
		opacity: 0.3;
	}

	/* Floor is roughly double the old fixed 0.75rem - the previous clamp's
	   floor matched the old size exactly, so on narrow columns (where cqw
	   resolves below it) it was silently clamping back down to the original
	   size. The cqw term still lets it scale up further on wide columns; the
	   overflow/nowrap below is what guarantees the horizontal grid layout
	   can't be pushed around if a column is ever narrower than the digits
	   need. Vertical padding eats a bit more of the stepper's height, which
	   is what shrinks the buttons above/below it further. */
	.iteration-value {
		flex: 0 0 auto;
		min-width: 0;
		font-size: clamp(1.4rem, 34cqw, 2rem);
		font-weight: 600;
		line-height: 1.15;
		padding-block: 0.2rem;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: clip;
	}

	.iteration-divider {
		flex: 0 0 auto;
		min-width: 0;
		font-size: clamp(1rem, 26cqw, 1.5rem);
		padding-block: 0.15rem;
		text-align: center;
		opacity: 0.7;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: clip;
	}
</style>
