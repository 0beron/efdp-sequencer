<script lang="ts">
	let {
		value,
		onChange,
		label,
		ariaLabel,
		displayValue
	}: {
		value: number;
		onChange: (value: number) => void;
		label: string;
		ariaLabel: string;
		displayValue: string;
	} = $props();

	let track: HTMLDivElement | undefined = $state();
	let dragging = $state(false);

	// The whole track rectangle is the drag surface (not just a thumb), so the
	// touch target is as large as the fader itself rather than a few-px handle.
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

<div class="fader-group">
	<span class="fader-label">{label}</span>
	<div
		class="fader-track"
		bind:this={track}
		role="slider"
		tabindex="0"
		aria-label={ariaLabel}
		aria-valuemin="0"
		aria-valuemax="1"
		aria-valuenow={value}
		aria-valuetext={displayValue}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onkeydown={onKeydown}
	>
		<div class="fader-fill" style={`height: ${value * 100}%`}></div>
	</div>
	<span class="fader-value">{displayValue}</span>
</div>

<style>
	.fader-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		height: 100%;
		width: 4.0rem;
		flex-shrink: 0;
	}

	.fader-label {
		font-size: 0.85rem;
		color: var(--color-text);
		white-space: nowrap;
	}

	.fader-value {
		font-size: 0.8rem;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.fader-track {
		flex: 1;
		min-height: 0;
		width: 100%;
		position: relative;
		display: flex;
		align-items: flex-end;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		touch-action: none;
		cursor: pointer;
		overflow: hidden;
	}

	.fader-fill {
		width: 100%;
		background: var(--color-accent);
		pointer-events: none;
	}
</style>
