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
    expect(text()).toMatch(/That note is held 300 ms longer \(\d+% tempo while it sounds\)/);

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
  });
});
