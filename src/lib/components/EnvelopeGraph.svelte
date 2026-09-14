<script lang="ts">
	let {
		attack,
		decay
	}: {
		attack: number;
		decay: number;
	} = $props();

	// Fixed drawing surface in SVG user units; the <svg> itself scales to fill
	// whatever width/height the caller gives it via CSS.
	const WIDTH = 100;
	const HEIGHT = 40;

	// p0 is the origin (bottom left). p1's x runs from 0 (attack=0) to half the
	// width (attack=1), always at the top. p2's x continues on from p1 by up to
	// the other half of the width (decay=0..1), back down at the bottom - so
	// the two diagonals trace a rise-then-fall envelope shape.
	let x1 = $derived(attack * (WIDTH / 2));
	let x2 = $derived(x1 + decay * (WIDTH / 2));
</script>

<svg
	class="envelope-graph"
	viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
	preserveAspectRatio="none"
	aria-hidden="true"
>
	<line class="axis" x1="0" y1="0" x2="0" y2={HEIGHT} />
	<line class="axis" x1="0" y1={HEIGHT} x2={WIDTH} y2={HEIGHT} />
	<polyline class="envelope" points={`0,${HEIGHT} ${x1},0 ${x2},${HEIGHT}`} />
</svg>

<style>
	.envelope-graph {
		display: block;
		width: 100%;
		height: 2rem;
		overflow: visible;
	}

	.axis {
		stroke: var(--color-border);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}

	.envelope {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
</style>
