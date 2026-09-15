<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { asset } from '$app/paths';
	import { SequencerEngine } from '$lib/sequencer/engine.svelte';
	import {
		createRow,
		setLength,
		totalPageCount,
		appendStepsCopyingFrom
	} from '$lib/sequencer/types';
	import SequencerRow, { type OverlayKind } from '$lib/components/SequencerRow.svelte';
	import { loadSampleLibrary, type SampleEntry } from '$lib/sequencer/sampleLibrary';
	import { KITS, type Kit } from '$lib/sequencer/kits';
	import {
		loadPersistedState,
		schedulePersist,
		decodeStateFromFragment,
		encodeStateToFragment,
		scheduleUrlSync,
		clearPersistedState
	} from '$lib/sequencer/persistence';

	const engine = new SequencerEngine();
	let ready = $state(false);
	let loading = $state(false);

	let activeOverlay: { rowId: string; kind: OverlayKind } | null = $state(null);

	// Remembers whichever overlay page (settings/sample/velocity/...) was last
	// viewed, across rows and across closing the overlay entirely, so opening
	// any row's overlay picks up where the last one left off instead of always
	// landing back on the settings page.
	let lastOverlayKind: OverlayKind = $state('settings');

	// Lets a tablet held in portrait opt into the landscape (16-across) row
	// layout instead of the cramped 4x4 stack meant for phones; orientation
	// still rotates normally, this just overrides the layout it picks. Tucked
	// behind the logo's settings overlay rather than the header itself, since
	// the header has no room to spare in phone portrait.
	const FORCE_WIDE_KEY = 'efdp-force-wide-layout';
	let forceWide = $state(browser ? localStorage.getItem(FORCE_WIDE_KEY) === 'true' : false);
	let settingsOpen = $state(false);

	// Display preference (like forceWide), not a one-off broadcast: persisted
	// so it stays put across reloads instead of resetting to the default.
	const GRID_MARKER_KEY = 'efdp-grid-marker-every';
	let gridMarkerEvery = $state(
		browser ? (Number(localStorage.getItem(GRID_MARKER_KEY)) || 4) : 4
	);

	// How many steps a page shows at once - a display preference like
	// gridMarkerEvery/forceWide (doesn't change the pattern, only how much of
	// it is shown at a time), so it's persisted the same way and deliberately
	// left out of the shareable link - a recipient should see the pattern at
	// their own preferred page size, not the sender's.
	const STEPS_PER_PAGE_KEY = 'efdp-steps-per-page';
	function clampStepsPerPage(value: number): number {
		return Math.min(16, Math.max(1, Math.round(value)));
	}
	let stepsPerPage = $state(
		browser ? clampStepsPerPage(Number(localStorage.getItem(STEPS_PER_PAGE_KEY)) || 16) : 16
	);

	// Which page of the pattern is currently being viewed - transient, not
	// persisted (resets to page 1 on reload, like scroll position would).
	let currentPage = $state(0);
	let pageCount = $derived(
		totalPageCount(
			engine.rows.map((voice) => voice.row),
			engine.sequenceLength,
			stepsPerPage
		)
	);
	let pageOffset = $derived(currentPage * stepsPerPage);

	// Clamps to the new last page (not back to page 1) whenever pageCount
	// shrinks - e.g. a row got shorter, sequence length dropped, or steps-per-
	// page rose. A $derived can't have side effects, hence the $effect.
	$effect(() => {
		if (currentPage > pageCount - 1) currentPage = Math.max(0, pageCount - 1);
	});

	// Jumps to the newly created page once every row's length (and the
	// sequence length) has actually grown to cover it - recomputed directly
	// rather than read off the `pageCount` derived, since a freshly mutated
	// $state's dependent $derived is only guaranteed fresh on next read, and
	// we want the definitely-post-mutation value here.
	function goToNewLastPage() {
		currentPage =
			totalPageCount(
				engine.rows.map((voice) => voice.row),
				engine.sequenceLength,
				stepsPerPage
			) - 1;
	}

	// Adds one page's worth of blank steps to every row and to the overall
	// sequence length. Every row grows by the same amount (not just rows that
	// already differ from the sequence length) so each row's own offset from
	// the sequence length - the polyrhythm "drift" a shorter/longer row
	// already has - stays exactly the same after the new page is added.
	// New steps come in blank for free: setLength only fills genuinely new
	// indices, leaving already-existing triggers untouched.
	function addBlankPage() {
		if (engine.playing) return;
		const pageSize = stepsPerPage;
		for (const voice of engine.rows) setLength(voice.row, voice.row.length + pageSize);
		engine.setSequenceLength(engine.sequenceLength + pageSize);
		goToNewLastPage();
	}

	// Same page-size extension as addBlankPage, but the new steps are
	// populated by copying whichever page is currently the sequencer's last
	// one (captured as `lastPageOffset` before anything is resized) instead
	// of starting blank - a "duplicate this page" action.
	function addPageCopyingLastPage() {
		if (engine.playing) return;
		const pageSize = stepsPerPage;
		const lastPageOffset = (pageCount - 1) * pageSize;
		for (const voice of engine.rows) {
			appendStepsCopyingFrom(voice.row, pageSize, lastPageOffset);
		}
		engine.setSequenceLength(engine.sequenceLength + pageSize);
		goToNewLastPage();
	}

	// Inverse of addBlankPage: shrinks every row by one page's worth of steps
	// (floored at 1, same minimum the per-row length stepper already enforces)
	// and drops the sequence length to match, discarding whatever was on the
	// rightmost page. A no-op with only one page left, since there'd be
	// nothing left to show. If the page being removed was the one in view,
	// the existing pageCount-clamping effect drops currentPage back onto the
	// new last page on its own.
	function removeLastPage() {
		if (engine.playing || pageCount <= 1) return;
		const pageSize = stepsPerPage;
		for (const voice of engine.rows) {
			setLength(voice.row, Math.max(1, voice.row.length - pageSize));
		}
		engine.setSequenceLength(engine.sequenceLength - pageSize);
	}

	function onForceWideChange(e: Event & { currentTarget: HTMLInputElement }) {
		forceWide = e.currentTarget.checked;
		if (browser) localStorage.setItem(FORCE_WIDE_KEY, String(forceWide));
	}

	function shortenGridMarkerEvery() {
		if (gridMarkerEvery <= 1) return;
		gridMarkerEvery -= 1;
		if (browser) localStorage.setItem(GRID_MARKER_KEY, String(gridMarkerEvery));
	}

	function lengthenGridMarkerEvery() {
		gridMarkerEvery += 1;
		if (browser) localStorage.setItem(GRID_MARKER_KEY, String(gridMarkerEvery));
	}

	// Total sequence length is the true .length of every row, shown here as a
	// single reference number rather than a per-row broadcast: each increment
	// shortens/lengthens every row by one step off wherever its own length
	// currently sits, so any drift a row already has from the others (its
	// polyrhythmic offset) is preserved rather than being collapsed back to a
	// uniform value. A row already at the 1-step floor simply stops shrinking
	// while the others keep going. To force rows back in sync, adjust their
	// individual lengths (or reset and retype the total length from scratch).
	function shortenSequenceLength() {
		if (engine.sequenceLength <= 1) return;
		for (const voice of engine.rows) {
			setLength(voice.row, Math.max(1, voice.row.length - 1));
		}
		engine.setSequenceLength(engine.sequenceLength - 1);
	}

	function lengthenSequenceLength() {
		for (const voice of engine.rows) setLength(voice.row, voice.row.length + 1);
		engine.setSequenceLength(engine.sequenceLength + 1);
	}

	function shortenStepsPerPage() {
		if (stepsPerPage <= 1) return;
		stepsPerPage = clampStepsPerPage(stepsPerPage - 1);
		if (browser) localStorage.setItem(STEPS_PER_PAGE_KEY, String(stepsPerPage));
	}

	function lengthenStepsPerPage() {
		stepsPerPage = clampStepsPerPage(stepsPerPage + 1);
		if (browser) localStorage.setItem(STEPS_PER_PAGE_KEY, String(stepsPerPage));
	}

	function navigateOverlay(fromRowId: string, kind: OverlayKind, direction: 1 | -1) {
		const ids = engine.rows.map((voice) => voice.row.id);
		const currentIndex = ids.indexOf(fromRowId);
		const nextIndex = (currentIndex + direction + ids.length) % ids.length;
		activeOverlay = { rowId: ids[nextIndex], kind };
	}

	// Same page state the main page-nav controls use, just driven from the
	// compact nav inside a row's overlay - moving the page here stays in
	// whatever overlay tab was open and reveals that tab's content for the
	// new page (e.g. the velocity faders shift to the new page's steps).
	function changePage(direction: 1 | -1) {
		currentPage = Math.min(pageCount - 1, Math.max(0, currentPage + direction));
	}

	// Restores a pattern in priority order: a shared link's URL hash first (so
	// opening one always shows that pattern, even over a returning user's own
	// saved session), then this browser's own localStorage save, then finally
	// the default kit, same as a first-ever visit. A hash that fails to decode
	// (stale, hand-edited, or from a browser without CompressionStream) is
	// treated the same as no hash at all.
	async function ensureLoaded() {
		if (ready || loading) return;
		loading = true;
		const fromUrl =
			browser && location.hash.length > 1
				? await decodeStateFromFragment(location.hash.slice(1))
				: null;
		const saved = fromUrl ?? (browser ? loadPersistedState() : null);
		if (saved && saved.rows.length > 0) {
			engine.setBpm(saved.bpm);
			engine.setSequenceLength(saved.sequenceLength);
			const library = await loadSampleLibrary();
			const byId = new Map(library.map((s) => [s.id, s]));
			for (const row of saved.rows) {
				const sample = row.sampleId ? byId.get(row.sampleId) : undefined;
				// A sample that no longer resolves (renamed/removed since the
				// save) comes back as a blank row - silent but keeping its
				// pattern/faders - rather than dropping the row entirely.
				if (sample) {
					await engine.addRow(row, sample.url);
				} else {
					engine.addBlankRow(row);
				}
			}
		} else {
			for (const s of KITS[0].samples) {
				await engine.addRow(
					createRow({ id: s.sampleId, name: s.name, sampleId: s.sampleId }),
					s.url
				);
			}
		}
		ready = true;
		loading = false;
	}

	onMount(() => {
		ensureLoaded();
	});

	// Autosaves on every change to bpm or any row's own state (pattern,
	// sample, faders, choke group, ...): to localStorage so the session
	// survives a reload, and to the URL hash so the address bar always
	// reflects the current pattern and can be copied to share it. Gated on
	// `ready` so the incremental row-by-row restore in ensureLoaded() above
	// never overwrites the save it's still in the middle of reading.
	$effect(() => {
		if (!ready) return;
		const bpm = engine.bpm;
		const sequenceLength = engine.sequenceLength;
		const rows = engine.snapshotRows();
		schedulePersist(bpm, sequenceLength, rows);
		scheduleUrlSync(bpm, sequenceLength, rows);
	});

	async function toggle() {
		await ensureLoaded();
		if (engine.playing) {
			engine.stop();
		} else {
			await engine.start();
		}
	}

	const MIN_BPM = 40;
	const MAX_BPM = 300;

	function onBpmInput(e: Event & { currentTarget: HTMLInputElement }) {
		const value = e.currentTarget.valueAsNumber;
		if (!Number.isNaN(value)) engine.setBpm(value);
	}

	function adjustBpm(delta: number) {
		const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, engine.bpm + delta));
		engine.setBpm(clamped);
	}

	// Builds the share link directly from current state rather than reading
	// location.href, so a copy right after an edit can't race the debounced
	// scheduleUrlSync in the effect above and grab a stale hash.
	let linkStatus: 'idle' | 'copied' | 'failed' = $state('idle');
	let linkStatusTimer: ReturnType<typeof setTimeout> | null = null;

	function buildShareUrl(): Promise<string> {
		return encodeStateToFragment(engine.bpm, engine.sequenceLength, engine.snapshotRows()).then(
			(fragment) => `${location.origin}${location.pathname}#${fragment}`
		);
	}

	function flashLinkStatus(status: 'copied' | 'failed') {
		linkStatus = status;
		if (linkStatusTimer !== null) clearTimeout(linkStatusTimer);
		linkStatusTimer = setTimeout(() => (linkStatus = 'idle'), 1500);
	}

	async function copyShareLink() {
		try {
			// Safari only honours navigator.clipboard.writeText when it's called
			// synchronously inside the gesture handler - by the time our gzip
			// compression above would resolve, it no longer counts as "trusted"
			// and the write is silently dropped. Passing a ClipboardItem whose
			// value is a pending Promise is the documented escape hatch: Safari
			// keeps the gesture association alive until that promise settles,
			// while the write() call itself still happens synchronously here.
			if (typeof ClipboardItem !== 'undefined') {
				await navigator.clipboard.write([
					new ClipboardItem({
						'text/plain': buildShareUrl().then((url) => new Blob([url], { type: 'text/plain' }))
					})
				]);
			} else {
				await navigator.clipboard.writeText(await buildShareUrl());
			}
			flashLinkStatus('copied');
		} catch {
			// Compression unsupported, clipboard permission denied, or (most
			// commonly on iOS) navigator.clipboard simply absent because the
			// page isn't served over HTTPS/localhost - all look the same from
			// here, so just tell the user it didn't work rather than staying
			// silent.
			flashLinkStatus('failed');
		}
	}

	// Mirrors SequencerRow's hold-to-remove pattern: clearing wipes every row's
	// grid/velocity/iteration/faders, so it needs the same guard against a
	// stray tap triggering it.
	const CLEAR_HOLD_MS = 1000;
	let clearHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let clearing = $state(false);

	function beginClearHold() {
		clearing = true;
		clearHoldTimer = setTimeout(() => {
			clearHoldTimer = null;
			clearing = false;
			engine.clearAll();
		}, CLEAR_HOLD_MS);
	}

	function cancelClearHold() {
		clearing = false;
		if (clearHoldTimer !== null) {
			clearTimeout(clearHoldTimer);
			clearHoldTimer = null;
		}
	}

	// Full reset, as opposed to the clear button above: wipes the autosaved
	// pattern *and* the display prefs (wide layout, grid marker spacing), then
	// reloads with no URL hash so ensureLoaded() falls all the way through to
	// the default kit, same as a first-ever visit. Reloading (rather than
	// resetting in-memory state by hand) is what actually makes this a *full*
	// reset - just stripping the hash and staying on the page would still
	// restore the old pattern from localStorage on the very next autosave-driven
	// read, since nothing else would have cleared it.
	const FULL_RESET_HOLD_MS = 1000;
	let fullResetHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let fullResetting = $state(false);

	function beginFullResetHold() {
		fullResetting = true;
		fullResetHoldTimer = setTimeout(() => {
			fullResetHoldTimer = null;
			fullResetting = false;
			clearPersistedState();
			if (browser) {
				localStorage.removeItem(FORCE_WIDE_KEY);
				localStorage.removeItem(GRID_MARKER_KEY);
				localStorage.removeItem(STEPS_PER_PAGE_KEY);
				location.assign(location.pathname);
			}
		}, FULL_RESET_HOLD_MS);
	}

	function cancelFullResetHold() {
		fullResetting = false;
		if (fullResetHoldTimer !== null) {
			clearTimeout(fullResetHoldTimer);
			fullResetHoldTimer = null;
		}
	}

	// A brand new row starts with no sample loaded, and its sample overlay is
	// opened immediately so the user picks one right away rather than seeing
	// a silent, unlabeled row sit in the list.
	function addRow() {
		if (engine.playing) return;
		const id = crypto.randomUUID();
		engine.addBlankRow(
			createRow({ id, name: 'New Row', sampleId: '', length: engine.sequenceLength })
		);
		activeOverlay = { rowId: id, kind: 'sample' };
	}

	async function chooseSample(rowId: string, sample: SampleEntry) {
		await engine.setRowSample(rowId, sample.id, sample.label, sample.url);
	}

	function removeRow(rowId: string) {
		engine.removeRow(rowId);
		if (activeOverlay?.rowId === rowId) activeOverlay = null;
	}

	// Applies a kit positionally — kit sample N replaces row N's sample,
	// leaving the row's pattern/faders/choke group untouched. Rows beyond the
	// kit's length are left alone.
	async function loadKit(kit: Kit) {
		if (engine.playing) return;
		await Promise.all(
			kit.samples.map((sample, index) => {
				const voice = engine.rows[index];
				return voice
					? engine.setRowSample(voice.row.id, sample.sampleId, sample.name, sample.url)
					: undefined;
			})
		);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && settingsOpen) settingsOpen = false;
	}}
/>

{#snippet pageNavControls()}
	<button
		type="button"
		class="control-btn page-nav-btn"
		disabled={engine.playing || pageCount <= 1}
		aria-label="Delete last page"
		onclick={removeLastPage}
	>
		−
	</button>
	<button
		type="button"
		class="control-btn page-nav-btn"
		disabled={currentPage === 0}
		aria-label="Previous page"
		onclick={() => currentPage--}
	>
		‹
	</button>
	<span class="page-nav-label">Page {currentPage + 1} / {pageCount}</span>
	<button
		type="button"
		class="control-btn page-nav-btn"
		disabled={currentPage === pageCount - 1}
		aria-label="Next page"
		onclick={() => currentPage++}
	>
		›
	</button>
	<button
		type="button"
		class="control-btn page-nav-btn"
		disabled={engine.playing}
		aria-label="Add a blank page"
		onclick={addBlankPage}
	>
		+
	</button>
	<button
		type="button"
		class="control-btn page-nav-btn"
		disabled={engine.playing}
		aria-label="Add a page, copying the last page's contents"
		onclick={addPageCopyingLastPage}
	>
		⧉
	</button>
{/snippet}

<div class="page" class:force-wide={forceWide}>
	<div class="sticky-controls">
		<div class="header">
			<img class="logo" src={asset('/img/neonquaver.png')} alt="EFDP Sequencer" />
			<button
				class="transport"
				onclick={toggle}
				disabled={loading}
				aria-label={loading ? 'Loading' : engine.playing ? 'Stop' : 'Play'}
			>
				{#if loading}
					Loading…
				{:else}
					{engine.playing ? '■' : '▶'}
				{/if}
			</button>
			<div class="bpm-control">
				<button
					type="button"
					class="bpm-step"
					onclick={() => adjustBpm(-10)}
					aria-label="Decrease tempo by 10"
				>
					-10
				</button>
				<button
					type="button"
					class="bpm-step"
					onclick={() => adjustBpm(-1)}
					aria-label="Decrease tempo by 1"
				>
					-1
				</button>
				<input
					type="number"
					class="bpm-input"
					min={MIN_BPM}
					max={MAX_BPM}
					step="1"
					value={engine.bpm}
					oninput={onBpmInput}
					aria-label="Tempo in beats per minute"
				/>
				<button
					type="button"
					class="bpm-step"
					onclick={() => adjustBpm(1)}
					aria-label="Increase tempo by 1"
				>
					+1
				</button>
				<button
					type="button"
					class="bpm-step"
					onclick={() => adjustBpm(10)}
					aria-label="Increase tempo by 10"
				>
					+10
				</button>
				<span class="bpm-label">BPM</span>
			</div>
			<div class="page-nav page-nav-header">
				{@render pageNavControls()}
			</div>
		</div>

		<div class="page-nav page-nav-inline">
			{@render pageNavControls()}
		</div>
	</div>

	<div class="toolbar">
		<button
			type="button"
			class="cog-btn"
			aria-label="Open settings"
			onclick={() => (settingsOpen = true)}
		>
			<span>⚙</span> Settings
		</button>
		<button
			type="button"
			class="copy-link-btn"
			class:failed={linkStatus === 'failed'}
			aria-label={linkStatus === 'copied'
				? 'Link copied'
				: linkStatus === 'failed'
					? 'Copy failed'
					: 'Copy share link'}
			onclick={copyShareLink}
		>
			<span>{linkStatus === 'copied' ? '✓' : linkStatus === 'failed' ? '🚫' : '🔗'}</span>
			{linkStatus === 'copied' ? 'Copied' : linkStatus === 'failed' ? 'Failed' : 'Copy link'}
		</button>
		<button
			type="button"
			class="clear-btn"
			class:holding={clearing}
			aria-label="Hold to clear grid"
			onpointerdown={beginClearHold}
			onpointerup={cancelClearHold}
			onpointerleave={cancelClearHold}
			onpointercancel={cancelClearHold}
		>
			<span class="clear-btn-fill"></span>
			<span class="clear-btn-icon">🧹</span>
			<span class="clear-btn-label">Clear pattern</span>
		</button>
	</div>

	<div class="rows">
		{#each engine.rows as voice (voice.row.id)}
			<SequencerRow
				row={voice.row}
				currentStep={engine.currentSteps[voice.row.id] ?? -1}
				{gridMarkerEvery}
				{pageOffset}
				{stepsPerPage}
				{currentPage}
				{pageCount}
				openOverlay={activeOverlay?.rowId === voice.row.id ? activeOverlay.kind : null}
				defaultOverlayKind={lastOverlayKind}
				onOverlayChange={(kind) => {
					activeOverlay = kind ? { rowId: voice.row.id, kind } : null;
					if (kind) lastOverlayKind = kind;
				}}
				onNavigateOverlay={(direction) =>
					activeOverlay && navigateOverlay(voice.row.id, activeOverlay.kind, direction)}
				onChangePage={changePage}
				onChooseSample={(sample) => chooseSample(voice.row.id, sample)}
				onRemoveRow={() => removeRow(voice.row.id)}
				onSoundChange={() => engine.updateRowSound(voice.row.id)}
			/>
		{/each}

		<button
			type="button"
			class="add-row"
			disabled={engine.playing}
			aria-label="Add row"
			onclick={addRow}
		>
			+
		</button>
	</div>

	{#if settingsOpen}
		<div class="overlay" role="dialog" aria-modal="true" aria-label="Settings">
			<div class="overlay-panel bounded-panel">
				<header>
					<h2>Settings</h2>
					<button
						type="button"
						class="close-btn"
						aria-label="Close settings"
						onclick={() => (settingsOpen = false)}
					>
						✕
					</button>
				</header>

				<label class="wide-toggle">
					<input type="checkbox" checked={forceWide} onchange={onForceWideChange} />
					Wide layout
				</label>

				<div class="stepper-control">
					<span class="stepper-label">Total sequence length</span>
					<div class="stepper-buttons">
						<button
							type="button"
							class="control-btn"
							aria-label="Shorten total sequence length by one step"
							disabled={engine.sequenceLength <= 1}
							onclick={shortenSequenceLength}
						>
							←
						</button>
						<span class="stepper-value">{engine.sequenceLength}</span>
						<button
							type="button"
							class="control-btn"
							aria-label="Lengthen total sequence length by one step"
							onclick={lengthenSequenceLength}
						>
							→
						</button>
					</div>
				</div>

				<div class="stepper-control">
					<span class="stepper-label">Max steps per page</span>
					<div class="stepper-buttons">
						<button
							type="button"
							class="control-btn"
							aria-label="Decrease max steps per page"
							disabled={stepsPerPage <= 1}
							onclick={shortenStepsPerPage}
						>
							←
						</button>
						<span class="stepper-value">{stepsPerPage}</span>
						<button
							type="button"
							class="control-btn"
							aria-label="Increase max steps per page"
							disabled={stepsPerPage >= 16}
							onclick={lengthenStepsPerPage}
						>
							→
						</button>
					</div>
				</div>

				<div class="stepper-control">
					<span class="stepper-label">Grid marker every...</span>
					<div class="stepper-buttons">
						<button
							type="button"
							class="control-btn"
							aria-label="Decrease grid marker spacing"
							disabled={gridMarkerEvery <= 1}
							onclick={shortenGridMarkerEvery}
						>
							←
						</button>
						<span class="stepper-value">{gridMarkerEvery}</span>
						<button
							type="button"
							class="control-btn"
							aria-label="Increase grid marker spacing"
							onclick={lengthenGridMarkerEvery}
						>
							→
						</button>
					</div>
				</div>

				<section class="kits">
					<h3>Kits</h3>
					<div class="kit-list">
						{#each KITS as kit (kit.id)}
							<button
								type="button"
								class="kit-btn"
								disabled={engine.playing}
								onclick={() => loadKit(kit)}
							>
								{kit.name}
							</button>
						{/each}
					</div>
				</section>

				<button
					type="button"
					class="full-reset-btn"
					class:holding={fullResetting}
					aria-label="Hold to fully reset: clears the pattern, layout and grid marker settings"
					onpointerdown={beginFullResetHold}
					onpointerup={cancelFullResetHold}
					onpointerleave={cancelFullResetHold}
					onpointercancel={cancelFullResetHold}
				>
					<span class="full-reset-btn-fill"></span>
					<span class="full-reset-btn-label">Hold to fully reset</span>
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1rem;
	}

	.page.force-wide {
		max-width: none;
	}

	/* width:100% is required here (unlike on .page): as a flex item, an auto
	   cross-axis margin disables the default stretch sizing and this would
	   otherwise shrink to fit its content instead of filling then clamping. */
	.bounded-panel {
		width: 100%;
		max-width: 60rem;
		margin: 0 auto;
	}

	.force-wide .bounded-panel {
		max-width: none;
	}

	/* Transport/bpm + page-nav stick together as one block in both
	   orientations, so they stay reachable while scrolling a tall grid -
	   one row in landscape (page-nav folds into .header there, and
	   .page-nav-inline goes display:none) or two in portrait. Deliberately
	   excludes .toolbar (settings/link/clear): that stays in normal flow so
	   it scrolls away with the grid instead of permanently eating screen
	   space, and keeping it out of this wrapper is also what keeps this
	   block's height fixed - nesting it in here let its content grow the
	   containing block and push the sticky element out from under itself. */
	.sticky-controls {
		position: sticky;
		top: env(safe-area-inset-top);
		z-index: 10;
		background: var(--color-bg);
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.header {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.logo {
		flex-shrink: 0;
		width: auto;
		height: 2.5rem;
	}

	.transport {
		width: 5rem;
		height: 2.5rem;
		padding: 0;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
	}

	.transport:disabled {
		opacity: 0.5;
	}

	.bpm-control {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 50%, transparent);
	}

	.bpm-input {
		width: 3rem;
		height: 2.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		text-align: center;
		font-size: 0.9rem;
	}

	.bpm-step {
		width: 2rem;
		height: 2.5rem;
		padding: 0;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.bpm-step:hover {
		background: var(--color-surface);
	}

	.bpm-label {
		font-size: 0.8rem;
		color: var(--color-text);
	}

	.toolbar {
		margin-top: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.cog-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.5rem;
		padding: 0 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.cog-btn span {
		font-size: 1rem;
	}

	.cog-btn:hover {
		background: var(--color-surface);
	}

	.copy-link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.5rem;
		padding: 0 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.copy-link-btn span {
		font-size: 1rem;
	}

	.copy-link-btn.failed {
		border-color: var(--color-danger, #b8433a);
		color: var(--color-danger, #b8433a);
	}

	.copy-link-btn:hover {
		background: var(--color-surface);
	}

	/* Hold-to-confirm fill, same pattern as SequencerRow's remove button, so a
	   stray tap can't wipe every row's grid and faders. */
	.clear-btn {
		position: relative;
		overflow: hidden;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		height: 2.5rem;
		padding: 0 0.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-danger, #b8433a);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.clear-btn-fill {
		position: absolute;
		inset: 0;
		width: 0%;
		background: var(--color-danger, #b8433a);
		pointer-events: none;
	}

	.clear-btn.holding .clear-btn-fill {
		width: 100%;
		transition: width 1s linear;
	}

	.clear-btn-icon {
		position: relative;
		z-index: 1;
		font-size: 1rem;
	}

	.clear-btn-label {
		position: relative;
		z-index: 1;
	}

	/* Same hold-to-confirm fill as .clear-btn above, but full-width and
	   labeled since it lives in the settings list rather than the toolbar -
	   and set apart with margin since it's the most destructive action here,
	   wiping the pattern *and* every other setting in this panel. */
	.full-reset-btn {
		position: relative;
		overflow: hidden;
		width: 100%;
		height: 2.5rem;
		margin-top: 1.5rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-danger, #b8433a);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.full-reset-btn-fill {
		position: absolute;
		inset: 0;
		width: 0%;
		background: var(--color-danger, #b8433a);
		pointer-events: none;
	}

	.full-reset-btn.holding .full-reset-btn-fill {
		width: 100%;
		transition: width 1s linear;
	}

	.full-reset-btn-label {
		position: relative;
		z-index: 1;
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

	.overlay-panel {
		flex: 1;
		padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
			max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
		overflow-y: auto;
	}

	.overlay-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
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

	.wide-toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1rem;
		color: var(--color-text);
	}

	.wide-toggle input {
		width: 1.25rem;
		height: 1.25rem;
	}

	.stepper-control {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-surface);
		width: fit-content;
		margin-top: 1.5rem;
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

	.control-btn {
		width: 2.25rem;
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

	.kits {
		margin-top: 1.5rem;
	}

	.kits h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
		color: var(--color-text);
	}

	.kit-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.kit-btn {
		height: 2.25rem;
		padding: 0 1rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.kit-btn:disabled {
		opacity: 0.5;
	}

	.kit-btn:not(:disabled):hover {
		background: var(--color-surface);
	}

	.page-nav {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, var(--color-accent) 50%, transparent);
	}

	/* Below the header, own centered row - the default (portrait) position. */
	.page-nav-inline {
		margin-top: 0.5rem;
		justify-content: center;
	}

	/* Folded into the header next to the BPM controls instead, once there's
	   room for it (landscape, or portrait with wide layout forced on) - see
	   the media query/force-wide overrides below, which swap which of the
	   two page-nav copies is actually shown. */
	.page-nav-header {
		display: none;
	}

	@media (orientation: landscape) {
		.page-nav-header {
			display: flex;
		}

		.page-nav-inline {
			display: none;
		}
	}

	:global(.force-wide) .page-nav-header {
		display: flex;
	}

	:global(.force-wide) .page-nav-inline {
		display: none;
	}

	.page-nav-label {
		min-width: 4.25rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-text);
	}

	/* Taller than the default .control-btn (used by the compact +/- steppers)
	   since these are the primary way to move around a multi-page pattern and
	   get pressed far more often - worth a bigger, easier-to-hit target. */
	.page-nav-btn {
		width: 2.25rem;
		height: 2.5rem;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		font-size: 1rem;
	}

	.rows {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.add-row {
		align-self: flex-start;
		width: 4.5rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-border);
		background: var(--color-surface-raised);
		color: var(--color-text);
		font-size: 1rem;
		line-height: 1;
	}

	.add-row:disabled {
		opacity: 0.5;
	}

	.add-row:not(:disabled):hover {
		background: var(--color-surface);
	}
</style>
