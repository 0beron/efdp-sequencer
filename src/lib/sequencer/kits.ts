// Hardcoded preset "kits" — sets of samples that can be loaded into the
// available rows all at once, positionally (kit sample N replaces row N),
// leaving any rows beyond the kit's length untouched. See +page.svelte's
// loadKit() for how these get applied.
import { asset } from '$app/paths';
import { toLabel } from './sampleLibrary';

export interface KitSample {
	sampleId: string;
	name: string;
	url: string;
}

export interface Kit {
	id: string;
	name: string;
	samples: KitSample[];
}

function sample(file: string, name?: string): KitSample {
	const sampleId = file.replace(/\.[^./]+$/, '');
	return { sampleId, name: name ?? toLabel(sampleId), url: asset(`/samples/${file}`) };
}

export const KITS: Kit[] = [
	{
		id: 'default',
		name: 'Default',
		samples: [
			sample('kick.wav', 'Kick'),
			sample('snare.wav', 'Snare'),
			sample('closed-hh.wav', 'Closed HH'),
			sample('open-hh.wav', 'Open HH'),
			sample('clap.wav', 'Clap'),
			sample('shaker.wav', 'Shaker'),
			sample('cowbell.wav', 'Cowbell'),
			sample('crash.wav', 'Crash')
		]
	},
	{
		id: '909',
		name: '909',
		samples: [
			sample('kick-909.wav'),
			sample('kick-909-2.wav'),
			sample('snare-909.wav'),
			sample('snare-9092.wav'),
			sample('closed-hh-909.wav'),
			sample('open-hh-909.wav'),
			sample('clap-909.wav')
		]
	},
	{
		id: 'acoustic',
		name: 'Acoustic',
		samples: [
			sample('kick-aco.wav'),
			sample('closed-hh-aco.wav'),
			sample('open-hh-aco.wav'),
			sample('clap-aco.wav'),
			sample('tom-hi-aco.wav'),
			sample('tom-med-aco.wav')
		]
	},
	{
		id: 'podorhythmie',
		name: 'Podorhythmie',
		samples: Array.from({ length: 14 }, (_, i) =>
			sample(`podo-${String(i + 1).padStart(3, '0')}.wav`)
		)
	}
];
