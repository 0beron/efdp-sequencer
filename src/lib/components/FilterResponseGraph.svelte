<script lang="ts">
	let {
		lowpassCutoff,
		lowpassResonance,
		highpassCutoff,
		highpassResonance
	}: {
		lowpassCutoff: number;
		lowpassResonance: number;
		highpassCutoff: number;
		highpassResonance: number;
	} = $props();

	// Fixed drawing surface in SVG user units; the <svg> itself scales to fill
	// whatever width/height the caller gives it via CSS.
	const WIDTH = 100;
	const HEIGHT = 40;
	const SAMPLES = 96;

	// How much of the 0..1 slider range the roll-off ramp and resonance peak
	// each span. Not tied to the faders' actual (log-ish) Hz mapping - this is
	// a rough visual hint, not a real frequency response - so plain fractions
	// of slider travel are enough.
	const ROLLOFF = 0.06;
	const BUMP_WIDTH = 0.05;
	const BUMP_HEIGHT = 0.9;
	// A real filter's stopband attenuation doesn't level off at a floor - it
	// keeps deepening (roughly linearly in dB per octave) the further you get
	// from the cutoff. Continuing the descent at this slope past ROLLOFF
	// (rather than flattening at -1) means a wide crossover gap keeps sinking
	// far enough to bury the other filter's resonance bump once summed,
	// instead of merely denting it. The two stay visually identical wherever
	// only one filter is active, since the final display value is still
	// clamped to -1..1.
	const FAR_SLOPE = 4;

	// Eases 0..1 with zero slope at both ends (3t^2 - 2t^3), so ramps meet the
	// flat passband tangentially instead of with a visible kink.
	function smoothstep(t: number): number {
		const c = Math.max(0, Math.min(1, t));
		return c * c * (3 - 2 * c);
	}

	// 0 in the passband, easing down past the highpass cutoff and continuing
	// to sink (unbounded) the further below it x goes; 0 everywhere when the
	// cutoff is all the way down (fully open).
	function highpassGain(x: number, cutoff: number): number {
		if (cutoff <= 0 || x >= cutoff) return 0;
		const dist = cutoff - x;
		if (dist <= ROLLOFF) return -smoothstep(dist / ROLLOFF);
		return -1 - (dist - ROLLOFF) * FAR_SLOPE;
	}

	// Mirror of highpassGain: 0 in the passband, sinking without bound above
	// the lowpass cutoff; 0 everywhere when the cutoff is all the way up.
	function lowpassGain(x: number, cutoff: number): number {
		if (cutoff >= 1 || x <= cutoff) return 0;
		const dist = x - cutoff;
		if (dist <= ROLLOFF) return -smoothstep(dist / ROLLOFF);
		return -1 - (dist - ROLLOFF) * FAR_SLOPE;
	}

	// A resonance bump only makes sense where there's an actual cutoff edge
	// to peak at - suppressed once that filter is fully open, so a cranked
	// resonance on an open filter doesn't paint a peak at the graph's edge.
	// Raised-cosine shape gives a rounded apex and a zero-slope landing back
	// at the baseline, rather than the sharp point/corner a triangle gives.
	function resonanceBump(x: number, center: number, resonance: number, active: boolean): number {
		if (!active) return 0;
		const dist = Math.abs(x - center);
		if (dist >= BUMP_WIDTH) return 0;
		return resonance * BUMP_HEIGHT * 0.5 * (1 + Math.cos((Math.PI * dist) / BUMP_WIDTH));
	}

	let points = $derived(
		Array.from({ length: SAMPLES }, (_, i) => {
			const x = i / (SAMPLES - 1);
			// The two filters are cascaded in the real signal chain (highpass
			// into lowpass), so their dB responses sum rather than the more-
			// attenuated one simply winning. Each stage's own rolloff and its
			// own resonance bump are combined into a full per-stage response
			// first, then the two stages are summed - that way a resonance
			// peak can only partly offset the other filter's rolloff, not
			// override it, matching how a real cascade behaves when the
			// cutoffs cross over into a nonexistent passband.
			const highpassResponse =
				highpassGain(x, highpassCutoff) +
				resonanceBump(x, highpassCutoff, highpassResonance, highpassCutoff > 0);
			const lowpassResponse =
				lowpassGain(x, lowpassCutoff) +
				resonanceBump(x, lowpassCutoff, lowpassResonance, lowpassCutoff < 1);
			const clamped = Math.max(-1, Math.min(1, highpassResponse + lowpassResponse));
			const px = x * WIDTH;
			const py = HEIGHT / 2 - clamped * (HEIGHT / 2 - 2);
			return `${px},${py}`;
		}).join(' ')
	);
</script>

<svg
	class="filter-graph"
	viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
	preserveAspectRatio="none"
	aria-hidden="true"
>
	<line class="baseline" x1="0" y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} />
	<polyline class="response" {points} />
</svg>

<style>
	.filter-graph {
		display: block;
		width: 100%;
		height: 2rem;
		overflow: visible;
	}

	.baseline {
		stroke: var(--color-border);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

	.response {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
</style>
