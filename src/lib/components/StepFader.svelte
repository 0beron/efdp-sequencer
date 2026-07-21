<script lang="ts">
	// A compact vertical slider sized to fill its grid cell (unlike Fader, which
	// is a fixed-width column with its own label/value text) so a row of these
	// can line up under the drum pad grid one-for-one. Shared by any per-step
	// overlay (velocity, probability, ...) that needs one fader per active step.
	let {
		value,
		onChange,
		ariaLabel
	}: {
		value: number;
		onChange: (value: number) => void;
		ariaLabel: string;
	} = $props();

	let track: HTMLDivElement | undefined = $state();
	let dragging = $state(false);

	function valueFromPointer(clientY: number): number {
		if (!track) return value;
		const rect = track.getBoundingClientRect();
		const ratio = (rect.bottom - clientY) / rect.height;
		return Math.min(1, Math.max(0, ratio));
	}

	function onPointerDown(e: PointerEvent) {
		e.preventDefault();
		track?.setPointerCapture(e.pointerId);
		dragging = true;
		onChange(valueFromPointer(e.clientY));
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		onChange(valueFromPointer(e.clientY));
	}

	function onPointerUp(e: PointerEvent) {
		dragging = false;
		track?.releasePointerCapture(e.pointerId);
	}

	function onKeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
			e.preventDefault();
			onChange(Math.min(1, value + step));
		} else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
			e.preventDefault();
			onChange(Math.max(0, value - step));
		} else if (e.key === 'Home') {
			e.preventDefault();
			onChange(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			onChange(1);
		}
	}
</script>

<div
	class="step-fader-track"
	bind:this={track}
	role="slider"
	tabindex="0"
	aria-label={ariaLabel}
	aria-valuemin="0"
	aria-valuemax="1"
	aria-valuenow={value}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onkeydown={onKeydown}
>
	<div class="step-fader-fill" style={`height: ${value * 100}%`}></div>
</div>

<style>
	.step-fader-track {
		width: 100%;
		height: 100%;
		position: relative;
		display: flex;
		align-items: flex-end;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		touch-action: none;
		cursor: pointer;
		overflow: hidden;
	}

	.step-fader-fill {
		width: 100%;
		background: var(--color-accent);
		pointer-events: none;
	}
</style>
