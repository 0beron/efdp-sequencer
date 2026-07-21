import * as Tone from 'tone';
import type { Row } from './types';
import { getEnvelopeParams, getFilterParams, triggerIndex, velocityToDb } from './types';

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
	}

	async addRow(row: Row, sampleUrl: string): Promise<void> {
		const highpass = new Tone.Filter({ type: 'highpass' });
		const gain = new Tone.Gain(row.gain).toDestination();
		const lowpass = new Tone.Filter({ type: 'lowpass' }).connect(gain);
		highpass.connect(lowpass);

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
		await Promise.all(voices.map((voice) => voice.player.load(sampleUrl)));

		this.rows.push({ row, voices, activeVoiceIndex: 1, highpass, lowpass, gain });
		this.currentSteps[row.id] = -1;
	}

	setBpm(bpm: number): void {
		this.bpm = bpm;
		Tone.getTransport().bpm.value = bpm;
	}

	async start(): Promise<void> {
		await Tone.start();
		const transport = Tone.getTransport();
		transport.bpm.value = this.bpm;
		this.pulse = 0;
		transport.scheduleRepeat((time) => this.onPulse(time), '16n');
		transport.start();
		this.playing = true;
	}

	stop(): void {
		const transport = Tone.getTransport();
		transport.stop();
		transport.cancel();
		this.playing = false;
		for (const voice of this.rows) {
			this.currentSteps[voice.row.id] = -1;
		}
	}

	private onPulse(time: number): void {
		for (const voice of this.rows) {
			const step = this.pulse % voice.row.length;
			const trigger = voice.row.triggers[triggerIndex(voice.row, step)];
			if (trigger?.active && Math.random() < trigger.probability) {
				this.triggerVoice(voice, time, trigger.velocity);
			}
			Tone.getDraw().schedule(() => {
				this.currentSteps[voice.row.id] = step;
			}, time);
		}
		this.pulse++;
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

		const filterParams = getFilterParams(voice.row);
		voice.highpass.frequency.value = filterParams.highpassFrequency;
		voice.highpass.Q.value = filterParams.highpassQ;
		voice.lowpass.frequency.value = filterParams.lowpassFrequency;
		voice.lowpass.Q.value = filterParams.lowpassQ;
		voice.gain.gain.value = voice.row.gain;

		incoming.envelope.cancel(time);
		incoming.envelope.triggerAttack(time);

		voice.activeVoiceIndex = incomingIndex;
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
