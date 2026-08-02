import * as Tone from 'tone';
import type { Row, Trigger } from './types';
import { getEnvelopeParams, getFilterParams, resetRow, triggerIndex, velocityToDb } from './types';

export interface EnvelopeVoice {
	player: Tone.Player;
	envelope: Tone.AmplitudeEnvelope;
}

export interface RowVoice {
	row: Row;
	// Two independent player+envelope chains, alternated on every trigger so
	// whichever envelope was just released always gets a full step's worth of
	// time to finish before it's reused — avoids retrigger clicks caused by
	// starting a new attack while the old envelope's ramp is still settling.
	voices: [EnvelopeVoice, EnvelopeVoice];
	activeVoiceIndex: 0 | 1;
	highpass: Tone.Filter;
	lowpass: Tone.Filter;
	gain: Tone.Gain;
}

// One shared pulse clock ticks once per step. Each row wraps around its own
// `length` independently, which is what makes rows of different lengths drift
// in and out of phase with each other over successive loops.
export class SequencerEngine {
	rows = $state<RowVoice[]>([]);
	currentSteps = $state<Record<string, number>>({});
	playing = $state(false);
	bpm = $state(120);

	private pulse = 0;
	// Per-row, per-trigger-index count of active passes reached so far, cycling
	// 1..iterationM; only stored for triggers actually reached during playback,
	// so it self-prunes across length/subdivision changes instead of needing
	// to be resized in step with row.triggers.
	private iterationCounters = new Map<string, Map<number, number>>();

	constructor() {
		// Mobile OSes can suspend the AudioContext when the system audio route
		// changes (e.g. a Bluetooth device disconnecting) and never resume it.
		// Reattach automatically whenever that happens mid-playback.
		Tone.getContext().on('statechange', () => {
			const context = Tone.getContext();
			if (this.playing && context.state !== 'running') {
				context.resume();
			}
		});
		// Registered exactly once for the engine's lifetime rather than in
		// start() - re-registering it on every start() (relying on stop()'s
		// transport.cancel() to remove the previous one) meant a re-entrant
		// start() call (e.g. a double-click before `playing` flips true) could
		// register a second repeat, doubling the rate onPulse fires and
		// skewing every row's step counter.
		Tone.getTransport().scheduleRepeat((time) => this.onPulse(time), '16n');
	}

	private createRowVoice(row: Row): RowVoice {
		const highpass = new Tone.Filter({ type: 'highpass' });
		const gain = new Tone.Gain(row.gain).toDestination();
		const lowpass = new Tone.Filter({ type: 'lowpass' }).connect(gain);
		highpass.connect(lowpass);
		// Tone.Filter defaults to frequency=350/Q=1 regardless of type. Without
		// this, a row's first trigger was the first time getFilterParams ever
		// ran, so every row's very first hit played through those leftover
		// defaults instead of its real (usually wide-open) filter settings - a
		// 350Hz lowpass badly muffles a drum sample's transient. Presetting them
		// here means every trigger, including the first, only ever sees the
		// row's real values.
		const initialFilterParams = getFilterParams(row);
		highpass.frequency.value = initialFilterParams.highpassFrequency;
		highpass.Q.value = initialFilterParams.highpassQ;
		lowpass.frequency.value = initialFilterParams.lowpassFrequency;
		lowpass.Q.value = initialFilterParams.lowpassQ;

		// Each voice gets its own player rather than sharing one between the
		// two envelopes — a shared player can only feed one envelope's chain
		// at a time, so reusing it here would leak the incoming hit into
		// whichever envelope it was last connected to.
		const makeVoice = (): EnvelopeVoice => {
			const envelope = new Tone.AmplitudeEnvelope().connect(highpass);
			const player = new Tone.Player().connect(envelope);
			return { player, envelope };
		};
		const voices: [EnvelopeVoice, EnvelopeVoice] = [makeVoice(), makeVoice()];
		return { row, voices, activeVoiceIndex: 1, highpass, lowpass, gain };
	}

	async addRow(row: Row, sampleUrl: string): Promise<void> {
		const voice = this.createRowVoice(row);
		await Promise.all(voice.voices.map((v) => v.player.load(sampleUrl)));
		this.rows.push(voice);
		this.currentSteps[row.id] = -1;
		this.iterationCounters.set(row.id, new Map());
	}

	// Adds a row with no sample loaded yet — used when the user hits "+" to
	// create a row before they've picked what it should sound like. Safe to
	// play immediately since a fresh row's triggers all start inactive, and
	// triggerVoice guards against an unloaded player regardless.
	addBlankRow(row: Row): void {
		this.rows.push(this.createRowVoice(row));
		this.currentSteps[row.id] = -1;
		this.iterationCounters.set(row.id, new Map());
	}

	// Tears down a row's Tone.js graph and drops it from playback state. Safe
	// to call mid-playback since the pulse loop only ever iterates `this.rows`,
	// which is spliced before any nodes are disposed.
	removeRow(rowId: string): void {
		const index = this.rows.findIndex((v) => v.row.id === rowId);
		if (index === -1) return;
		const [voice] = this.rows.splice(index, 1);
		for (const v of voice.voices) {
			v.player.dispose();
			v.envelope.dispose();
		}
		voice.highpass.dispose();
		voice.lowpass.dispose();
		voice.gain.dispose();
		delete this.currentSteps[rowId];
		this.iterationCounters.delete(rowId);
	}

	// Swaps the sample backing an existing row (used by the sample picker
	// overlay), reloading both of its envelope voices' players in place so
	// the row's identity (steps, faders, choke group, ...) is untouched.
	async setRowSample(
		rowId: string,
		sampleId: string,
		name: string,
		sampleUrl: string
	): Promise<void> {
		const voice = this.rows.find((v) => v.row.id === rowId);
		if (!voice) return;
		await Promise.all(voice.voices.map((v) => v.player.load(sampleUrl)));
		voice.row.sampleId = sampleId;
		voice.row.name = name;
	}

	// Resets every row's grid, velocity/probability/iteration, faders, filters
	// and choke group back to defaults - leaves each row's sample, name and
	// shape untouched. Also clears iteration counters so a still-running loop
	// doesn't carry over stale pass counts for the wiped triggers.
	clearAll(): void {
		for (const voice of this.rows) {
			resetRow(voice.row);
			this.iterationCounters.set(voice.row.id, new Map());
		}
	}

	setBpm(bpm: number): void {
		this.bpm = bpm;
		Tone.getTransport().bpm.value = bpm;
	}

	// Plain-data snapshot of every row's own state, suitable for JSON
	// serialization - excludes the rest of RowVoice (players, envelopes,
	// filters), which isn't part of the row itself and isn't serializable.
	snapshotRows(): Row[] {
		return this.rows.map((voice) => $state.snapshot(voice.row));
	}

	async start(): Promise<void> {
		// Set (and check) `playing` synchronously, before the first await, so
		// a second start() call landing while this one is still awaiting
		// Tone.start() - e.g. a double-click - sees playing already true and
		// bails out instead of racing this call.
		if (this.playing) return;
		this.playing = true;
		await Tone.start();
		const transport = Tone.getTransport();
		transport.bpm.value = this.bpm;
		this.pulse = 0;
		transport.start();
	}

	stop(): void {
		Tone.getTransport().stop();
		this.playing = false;
		for (const voice of this.rows) {
			this.currentSteps[voice.row.id] = -1;
			this.iterationCounters.get(voice.row.id)?.clear();
		}
	}

	private onPulse(time: number): void {
		for (const voice of this.rows) {
			const step = this.pulse % voice.row.length;
			const idx = triggerIndex(voice.row, step);
			const trigger = voice.row.triggers[idx];
			if (
				trigger?.active &&
				this.reachedIteration(voice.row.id, idx, trigger) &&
				Math.random() < trigger.probability
			) {
				this.triggerVoice(voice, time, trigger.velocity);
			}
			Tone.getDraw().schedule(() => {
				this.currentSteps[voice.row.id] = step;
			}, time);
		}
		this.pulse++;
	}

	// Advances the trigger's own pass counter (cycling 1..iterationM) and
	// reports whether this pass lands on iterationN, i.e. whether the note
	// should sound at all before probability gets a chance to silence it.
	private reachedIteration(rowId: string, idx: number, trigger: Trigger): boolean {
		const counters = this.iterationCounters.get(rowId);
		if (!counters) return true;
		const m = Math.max(1, trigger.iterationM);
		const n = Math.min(Math.max(1, trigger.iterationN), m);
		const count = (counters.get(idx) ?? 0) + 1;
		counters.set(idx, count >= m ? 0 : count);
		return count === n;
	}

	// Alternates the row between its two envelope voices on every hit: the
	// incoming voice plays the new sample from a fresh attack, while the
	// other voice — which may still be sounding from its previous hit — is
	// choked off immediately (cancel any pending automation, then release).
	// Because the two voices swap on every trigger, no lookahead scheduling
	// is needed to time the release ahead of the next note.
	private triggerVoice(voice: RowVoice, time: number, velocity: number): void {
		const incomingIndex = voice.activeVoiceIndex === 0 ? 1 : 0;
		const incoming = voice.voices[incomingIndex];
		const outgoing = voice.voices[voice.activeVoiceIndex];

		// A freshly-added row can have its triggers toggled on before a sample
		// is ever chosen for it; skip silently rather than letting Tone.js
		// throw on a player with no buffer loaded.
		if (!incoming.player.loaded) return;

		outgoing.envelope.cancel(time);
		outgoing.envelope.triggerRelease(time);
		outgoing.player.stop(time);

		if (voice.row.chokeGroup !== 0) {
			for (const other of this.rows) {
				if (other !== voice && other.row.chokeGroup === voice.row.chokeGroup) {
					this.chokeVoice(other, time);
				}
			}
		}

		incoming.player.volume.setValueAtTime(velocityToDb(velocity), time);
		incoming.player.stop(time);
		incoming.player.start(time);

		const params = getEnvelopeParams(voice.row);
		incoming.envelope.attack = params.attack;
		incoming.envelope.decay = params.decay;
		incoming.envelope.sustain = params.sustain;
		incoming.envelope.release = params.release;

		this.applyFilterAndGain(voice);

		incoming.envelope.cancel(time);
		incoming.envelope.triggerAttack(time);

		voice.activeVoiceIndex = incomingIndex;
	}

	// Pushes a row's current filter cutoff/resonance and gain onto its live
	// audio nodes. Every trigger does this anyway (a row's sound can change
	// between hits), but filters and gain - unlike attack/decay, which only
	// shape a *new* note - are audible on an already-sounding voice too, so
	// updateRowSound below calls this directly to apply a fader move
	// immediately instead of leaving it to sit unheard until the row's next
	// trigger picks it up.
	private applyFilterAndGain(voice: RowVoice): void {
		const filterParams = getFilterParams(voice.row);
		voice.highpass.frequency.value = filterParams.highpassFrequency;
		voice.highpass.Q.value = filterParams.highpassQ;
		voice.lowpass.frequency.value = filterParams.lowpassFrequency;
		voice.lowpass.Q.value = filterParams.lowpassQ;
		voice.gain.gain.value = voice.row.gain;
	}

	// Call after changing a row's filter or gain fader so the change is heard
	// right away, rather than waiting for the row's next trigger.
	updateRowSound(rowId: string): void {
		const voice = this.rows.find((v) => v.row.id === rowId);
		if (voice) this.applyFilterAndGain(voice);
	}

	// Immediately silences whichever of the row's two voices is currently
	// sounding, for a choke triggered by another row in the same choke group.
	private chokeVoice(voice: RowVoice, time: number): void {
		const active = voice.voices[voice.activeVoiceIndex];
		active.envelope.cancel(time);
		active.envelope.triggerRelease(time);
		active.player.stop(time);
	}
}
