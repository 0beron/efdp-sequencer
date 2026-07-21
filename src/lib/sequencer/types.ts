// A row's trigger grid is stored flat at whatever resolution it currently needs:
// `length` steps, each divided into `subdivision` substeps (1 = no subdivision).
// index = step * subdivision + substep. This lets a row's length and its zoom
// level (subdivision) vary independently, without changing the shape of the model.

export interface Trigger {
	active: boolean;
	// Normalized 0..1 per-step velocity. Defaults to 1 (full) so existing
	// triggers play at their previous volume until the user dials one down.
	velocity: number;
	// Normalized 0..1 chance the trigger actually fires each time it's reached.
	// Defaults to 1 (always plays) so existing triggers behave as before.
	probability: number;
}

export interface Row {
	id: string;
	name: string;
	sampleId: string;
	length: number;
	subdivision: number;
	triggers: Trigger[];
	// Normalized 0..1 fader positions for the per-row amplitude envelope.
	// See getEnvelopeParams for how these map to actual attack/decay/sustain times.
	attack: number;
	decay: number;
	// Normalized 0..1 overall row volume, applied 1:1 as a Tone.Gain gain value.
	gain: number;
	// Normalized 0..1 fader positions for the per-row low pass and high pass filters.
	// See getFilterParams for how these map to actual cutoff frequencies and Q.
	lowpassCutoff: number;
	lowpassResonance: number;
	highpassCutoff: number;
	highpassResonance: number;
	// 0 means "None" (no choking across rows). Any other value chokes (immediately
	// stops) samples on every other row sharing the same non-zero choke group.
	chokeGroup: number;
}

export function totalSubsteps(row: Pick<Row, 'length' | 'subdivision'>): number {
	return row.length * row.subdivision;
}

export function triggerIndex(row: Pick<Row, 'subdivision'>, step: number, substep = 0): number {
	return step * row.subdivision + substep;
}

export function createRow(options: {
	id: string;
	name: string;
	sampleId: string;
	length?: number;
	subdivision?: number;
}): Row {
	const length = options.length ?? 16;
	const subdivision = options.subdivision ?? 1;
	return {
		id: options.id,
		name: options.name,
		sampleId: options.sampleId,
		length,
		subdivision,
		triggers: Array.from({ length: length * subdivision }, () => ({
			active: false,
			velocity: 1,
			probability: 1
		})),
		attack: 0,
		decay: 1,
		gain: 1,
		// Both filters default fully open (lowpass ceiling, highpass floor) so a
		// freshly created row sounds unfiltered until the user dials one in.
		lowpassCutoff: 1,
		lowpassResonance: 0,
		highpassCutoff: 0,
		highpassResonance: 0,
		chokeGroup: 0
	};
}

export function setAttack(row: Row, value: number): void {
	row.attack = value;
}

export function setDecay(row: Row, value: number): void {
	row.decay = value;
}

export function setGain(row: Row, value: number): void {
	row.gain = value;
}

export function setLowpassCutoff(row: Row, value: number): void {
	row.lowpassCutoff = value;
}

export function setLowpassResonance(row: Row, value: number): void {
	row.lowpassResonance = value;
}

export function setHighpassCutoff(row: Row, value: number): void {
	row.highpassCutoff = value;
}

export function setHighpassResonance(row: Row, value: number): void {
	row.highpassResonance = value;
}

export function setChokeGroup(row: Row, value: number): void {
	row.chokeGroup = Math.max(0, Math.round(value));
}

// Fader values are normalized 0..1; these scale them to actual envelope times.
export const MAX_ATTACK_SECONDS = 0.4;
export const MAX_DECAY_SECONDS = 0.8;

export interface EnvelopeParams {
	attack: number;
	decay: number;
	sustain: number;
	release: number;
}

// Decay at max means "hold at full volume" (sustain = max, decay never audible).
// Any adjustment away from max drops sustain to 0, so the sample decays to
// silence over the fader's time instead of holding — shorter time as it's turned down.
export function getEnvelopeParams(row: Pick<Row, 'attack' | 'decay'>): EnvelopeParams {
	return {
		attack: row.attack * MAX_ATTACK_SECONDS,
		decay: row.decay * MAX_DECAY_SECONDS,
		sustain: row.decay >= 1 ? 1 : 0,
		release: 0
	};
}

// Per-step velocity fader is normalized 0..1; this scales it to a player volume
// in dB. Linear (not exponential) since it's a direct gain trim, not a frequency.
export const MIN_VELOCITY_DB = -36;

export function velocityToDb(value: number): number {
	if (value <= 0) return -Infinity;
	return MIN_VELOCITY_DB * (1 - value);
}

// Fader values are normalized 0..1; these scale them to actual filter frequency/Q.
export const MIN_FILTER_FREQUENCY_HZ = 20;
export const MAX_FILTER_FREQUENCY_HZ = 20000;
export const MIN_FILTER_Q = 0.1;
export const MAX_FILTER_Q = 20;

// Cutoff faders scale exponentially (as with any audio frequency control) so the
// full fader travel is perceptually even across the range, rather than bunching
// most of the useful range into the first few percent of travel.
export function normalizedToFilterFrequency(value: number): number {
	return (
		MIN_FILTER_FREQUENCY_HZ * Math.pow(MAX_FILTER_FREQUENCY_HZ / MIN_FILTER_FREQUENCY_HZ, value)
	);
}

export function normalizedToFilterQ(value: number): number {
	return MIN_FILTER_Q + value * (MAX_FILTER_Q - MIN_FILTER_Q);
}

export interface FilterParams {
	lowpassFrequency: number;
	lowpassQ: number;
	highpassFrequency: number;
	highpassQ: number;
}

export function getFilterParams(
	row: Pick<Row, 'lowpassCutoff' | 'lowpassResonance' | 'highpassCutoff' | 'highpassResonance'>
): FilterParams {
	return {
		lowpassFrequency: normalizedToFilterFrequency(row.lowpassCutoff),
		lowpassQ: normalizedToFilterQ(row.lowpassResonance),
		highpassFrequency: normalizedToFilterFrequency(row.highpassCutoff),
		highpassQ: normalizedToFilterQ(row.highpassResonance)
	};
}

export function isStepActive(row: Row, step: number, substep = 0): boolean {
	return row.triggers[triggerIndex(row, step, substep)]?.active ?? false;
}

export function toggleTrigger(row: Row, step: number, substep = 0): void {
	const trigger = row.triggers[triggerIndex(row, step, substep)];
	if (trigger) trigger.active = !trigger.active;
}

export function getVelocity(row: Row, step: number, substep = 0): number {
	return row.triggers[triggerIndex(row, step, substep)]?.velocity ?? 1;
}

export function setVelocity(row: Row, step: number, value: number, substep = 0): void {
	const trigger = row.triggers[triggerIndex(row, step, substep)];
	if (trigger) trigger.velocity = Math.min(1, Math.max(0, value));
}

export function getProbability(row: Row, step: number, substep = 0): number {
	return row.triggers[triggerIndex(row, step, substep)]?.probability ?? 1;
}

export function setProbability(row: Row, step: number, value: number, substep = 0): void {
	const trigger = row.triggers[triggerIndex(row, step, substep)];
	if (trigger) trigger.probability = Math.min(1, Math.max(0, value));
}

// Resize helpers preserve existing triggers where possible rather than discarding them,
// since these will back the (not-yet-built) length/zoom controls.

export function setLength(row: Row, newLength: number): void {
	const newTriggers = Array.from(
		{ length: newLength * row.subdivision },
		(_, i) => row.triggers[i] ?? { active: false, velocity: 1, probability: 1 }
	);
	row.length = newLength;
	row.triggers = newTriggers;
}

export function setSubdivision(row: Row, newSubdivision: number): void {
	const oldSubdivision = row.subdivision;
	const newTriggers = Array.from({ length: row.length * newSubdivision }, () => ({
		active: false,
		velocity: 1,
		probability: 1
	}));

	for (let step = 0; step < row.length; step++) {
		for (let substep = 0; substep < oldSubdivision; substep++) {
			const oldTrigger = row.triggers[step * oldSubdivision + substep];
			if (!oldTrigger?.active) continue;
			const newSubstep = Math.floor((substep * newSubdivision) / oldSubdivision);
			const newTrigger = newTriggers[step * newSubdivision + newSubstep];
			newTrigger.active = true;
			newTrigger.velocity = oldTrigger.velocity;
			newTrigger.probability = oldTrigger.probability;
		}
	}

	row.subdivision = newSubdivision;
	row.triggers = newTriggers;
}
