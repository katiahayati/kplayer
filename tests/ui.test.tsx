// @vitest-environment jsdom
// Smoke test of the whole app: load the fixture through the file picker, then
// use the score's breath mark, add a breath by clicking a note and pressing B,
// and add a tempo section with shift-click. Audio is never started.
// (jsdom rather than happy-dom: happy-dom stops parsing SVG at Verovio's <style>.)

import { File as NodeFile } from 'node:buffer';
import fs from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lacks these; layout isn't needed for this test.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
const click = (el: Element, init: MouseEventInit = {}) =>
  act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })));

describe('app', () => {
  it('loads a score and adds breaths and a section', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    await act(async () => createRoot(host).render(<App />));
    expect(text()).toContain('Open a MusicXML score');

    const input = document.querySelector<HTMLInputElement>('.empty input[type=file]')!;
    // jsdom's File has no arrayBuffer(); Node's does.
    const file = new NodeFile([fs.readFileSync('fixtures/song.musicxml')], 'song.musicxml');
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await vi.waitFor(() => expect(document.querySelector('.svg-pages svg') ?? document.querySelector('.error')?.textContent ?? null).not.toBeNull(), { timeout: 20000 });
    expect(document.querySelector('.error')?.textContent).toBeUndefined();

    // The written breath mark is offered and becomes a breath.
    await click(button("Use the score's 1 breath mark"));
    expect(text()).toContain('Breath · 300 ms');
    expect(document.querySelectorAll('.breath-marker').length).toBeGreaterThanOrEqual(0);

    // Click the last voice note of bar 3 and press B.
    const notes = [...document.querySelectorAll('g.note')];
    expect(notes.length).toBeGreaterThan(10);
    const voiceBar3 = document.querySelectorAll('g.measure')[2].querySelectorAll('g.staff')[0].querySelectorAll('g.note');
    await click(voiceBar3[voiceBar3.length - 1]);
    expect(text()).toContain('Breathe after');
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' })));
    expect([...document.querySelectorAll('.list li')].filter((li) => li.textContent?.includes('Breath')).length).toBe(2);
    expect(text()).toMatch(/Adds 300 ms; slowest point \d+% of the tempo/);

    // Shift-click a range and broaden it.
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    const voiceBar1 = document.querySelectorAll('g.measure')[0].querySelectorAll('g.staff')[0].querySelectorAll('g.note');
    await click(voiceBar1[0]);
    await click(voiceBar3[0], { shiftKey: true });
    expect(text()).toContain('Section');
    await click(button('Broaden'));
    expect(text()).toContain('Broaden · 10%');
    expect(document.querySelectorAll('.svg-pages g.in-range').length).toBeGreaterThan(0);

    // The tempo lane draws a curve with a band per gesture pass.
    expect(document.querySelector('.tempo-curve')?.getAttribute('d')?.length).toBeGreaterThan(100);
    expect(document.querySelectorAll('.band').length).toBe(4);

    // The panel marks gestures against the playhead (clicking a note moves it there while paused).
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    const voiceBar2Notes = document.querySelectorAll('g.measure')[1].querySelectorAll('g.staff')[0].querySelectorAll('g.note');
    await click(voiceBar2Notes[0]); // bar 2, inside the broadening
    const now = () => [...document.querySelectorAll('.list button.now')].map((b) => b.textContent ?? '');
    expect(now()).toHaveLength(1);
    expect(now()[0]).toContain('Broaden');
    expect(document.querySelector('.playhead-marker')).toBeNull();
    const lastBar = [...document.querySelectorAll('g.measure')].at(-1)!.querySelectorAll('g.note');
    await click(lastBar[0]); // the last bar: after every gesture
    expect(now()).toHaveLength(0);
    const items = [...document.querySelectorAll('.list li')];
    expect(items.at(-1)?.classList.contains('playhead-marker')).toBe(true);
    // Back to the beginning (the button, then Home).
    const position = () => document.querySelector('.position')?.textContent ?? '';
    const atStart = position().replace(/^.*? · /, '').startsWith('0:00');
    expect(atStart).toBe(false);
    await click(document.querySelector('button[aria-label="Back to the beginning"]')!);
    expect(position().replace(/^.*? · /, '')).toMatch(/^0:00/);
    await click(lastBar[0]);
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })));
    expect(position().replace(/^.*? · /, '')).toMatch(/^0:00/);
    await click(lastBar[0]);
    // Re-select the section for the steps below.
    await click(button('Broaden · 10%'));

    // Put the peak on a note and hold it until a later one.
    await click(button('Peak on a note instead'));
    expect(text()).toContain('where the peak arrives');
    expect(document.querySelector('.score-pages.picking')).not.toBeNull();
    await click(voiceBar1[2]); // E5 on beat 3 of bar 1
    expect(document.querySelector('.pick-row .chip')?.textContent).toContain('m. 1, ♩3');
    const voiceBar2 = document.querySelectorAll('g.measure')[1].querySelectorAll('g.staff')[0].querySelectorAll('g.note');
    await click(button('Pick note'));
    await click(voiceBar2[1]); // D5 on beat 2 of bar 2
    expect([...document.querySelectorAll('.pick-row .chip')].map((c) => c.textContent)).toEqual(['m. 1, ♩3×', 'm. 2, ♩2×']);
    expect(text()).toContain('holds it until the hold note');
    // Esc while picking cancels the pick but keeps the section selected.
    await click(button('Change'));
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('.score-pages.picking')).toBeNull();
    expect(text()).toContain('Peak on');

    // Undo steps back through the hold, the peak, then the section itself.
    const undo = () => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await undo();
    expect(document.querySelectorAll('.pick-row .chip').length).toBe(1);
    await undo();
    await undo();
    expect(text()).not.toContain('Broaden · 10%');

    // A Slow down keeps its tempo after it ends: past it, the panel shows it as holding.
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await click(voiceBar1[0]);
    await click(voiceBar1[1], { shiftKey: true });
    await click(button('Slow down'));
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await click(voiceBar2Notes[1]);
    const holding = [...document.querySelectorAll('.list button.holding')].map((b) => b.textContent ?? '');
    expect(holding).toHaveLength(1);
    expect(holding[0]).toContain('Slow down to 85%');

    // A Speed up after it starts from that 85%, and shows the tempi (the fixture is ♩ = 72).
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await click(voiceBar2Notes[0]);
    await click(voiceBar2Notes[1], { shiftKey: true });
    await click(button('Speed up'));
    expect(text()).toContain('Speed up to 98%');
    expect(text()).toContain('from 85%: ♩ = 61 → 71');

    // The Tempo slider changes the tempi, not the percentages.
    const slide = (el: HTMLInputElement, v: number) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const tempoSlider = document.querySelector<HTMLInputElement>('.tempo input[type=range]')!;
    await slide(tempoSlider, 50);
    expect(text()).toContain('from 85%: ♩ = 31 → 35');
    expect(text()).toContain('Speed up to 98%');
    await slide(tempoSlider, 100);
    expect(text()).toContain('from 85%: ♩ = 61 → 71');

    // Deleting the Slow down leaves the other section arriving at 98%: it now slows down to it from 100%.
    await click(button('Slow down to 85%'));
    await click(button('Delete'));
    expect(text()).not.toContain('to 85%');
    await click(button('Slow down to 98%'));
    expect(text()).toContain('from 100%: ♩ = 72 → 71');
    // Its own slider changes only it.
    await slide(document.querySelector<HTMLInputElement>('.inspector .slider input[type=range]')!, 120);
    expect(text()).toContain('Speed up to 120%');
    expect(text()).toContain('from 100%: ♩ = 72 → 86');
    // Undo brings back the old target, then the deleted Slow down, and the other section is as it was.
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect(text()).toContain('Slow down to 85%');
    expect(text()).toContain('Speed up to 98%');

    // Clear all removes every gesture after confirming, and undo brings them back.
    const count = document.querySelectorAll('.list li button').length;
    window.confirm = () => true;
    await click(button('Clear all'));
    expect(document.querySelector('.list')).toBeNull();
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect(document.querySelectorAll('.list li button').length).toBe(count);

    // Import a voicing (only the dynamics), see its notes, and how loud a selected note plays.
    const gesturesBefore = document.querySelectorAll('.list li button').length;
    const voicing = { dynamics: { voices: [{ id: 'rh', name: 'Right hand', select: { part: 1, staff: [1] }, gainDb: -6 }] } };
    const voicingInput = document.querySelector<HTMLInputElement>('.dynamics input[type=file]')!;
    Object.defineProperty(voicingInput, 'files', { value: [new NodeFile([JSON.stringify(voicing)], 'voicing.json')], configurable: true });
    await act(async () => void voicingInput.dispatchEvent(new Event('change', { bubbles: true })));
    await vi.waitFor(() => expect(text()).toContain('Right hand'));
    expect(text()).toContain('Piano, upper staff');
    expect(document.querySelectorAll('.list li button').length).toBe(gesturesBefore); // the phrasing is kept
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await click(button('Right hand'));
    const lit = document.querySelectorAll('.svg-pages g.in-range');
    expect(lit.length).toBeGreaterThan(0);
    expect([...lit].every((g) => g.closest('g.staff') === g.closest('g.measure')!.querySelectorAll('g.staff')[1])).toBe(true);
    // The fixture has no written dynamics, so mf (72), 6 dB down.
    const pianoRh = document.querySelectorAll('g.measure')[0].querySelectorAll('g.staff')[1].querySelectorAll('g.note');
    await click(pianoRh[0]);
    expect(text()).toContain(`Selected note: Right hand, velocity ${Math.round(72 * 10 ** (-6 / 40))}`);
    await slide(document.querySelector<HTMLInputElement>('.dynamics .slider input[type=range]')!, -12);
    expect(text()).toContain(`Selected note: Right hand, velocity ${Math.round(72 * 10 ** (-12 / 40))}`);
    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect(text()).toContain(`velocity ${Math.round(72 * 10 ** (-6 / 40))}`);

    // Importing phrasing alone (breaths, no dynamics) keeps the voicing.
    const phrasing = { version: 2, tempoFactor: 1, parts: {}, gestures: [{ id: 'b9', type: 'breath', at: { measureIndex: 1, offsetQ: 2 }, extraMs: 300, beforeBeats: 1, afterBeats: 0.5 }] };
    const importInput = document.querySelector<HTMLInputElement>('.transport input[accept=".json"]')!;
    Object.defineProperty(importInput, 'files', { value: [new NodeFile([JSON.stringify(phrasing)], 'phrasing.kplayer.json')], configurable: true });
    await act(async () => void importInput.dispatchEvent(new Event('change', { bubbles: true })));
    await vi.waitFor(() => expect([...document.querySelectorAll('.list li')].filter((li) => li.textContent?.includes('Breath')).length).toBe(1));
    expect(text()).toContain('Right hand');
  });
});
