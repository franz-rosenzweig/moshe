// The voice keys (src/voice/keys.js): what a press is, what can be one, how it's shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEvent, matches, label, problem, voiceKeys, parse, DEFAULTS } from '../src/voice/keys.js';

const press = (code, mods = {}) => ({ code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

test('a press is its modifiers and its place on the keyboard', () => {
  assert.equal(fromEvent(press('KeyL', { alt: true, meta: true })), 'Alt+Meta+KeyL');
  assert.equal(fromEvent(press('F6')), 'F6');
  assert.equal(fromEvent(press('KeyL', { meta: true, shift: true, alt: true, ctrl: true })), 'Ctrl+Alt+Shift+Meta+KeyL');
  assert.equal(fromEvent(press('MetaLeft', { meta: true })), null, 'a modifier alone is a chord still being made');
  assert.ok(matches('Alt+Meta+KeyL', press('KeyL', { alt: true, meta: true })));
  assert.ok(!matches('Alt+Meta+KeyL', press('KeyL', { alt: true, meta: true, shift: true })));
  assert.ok(!matches('Ctrl+Alt+KeyL', { ...press('KeyL', { ctrl: true, alt: true }), getModifierState: (m) => m === 'AltGraph' }), 'AltGr types letters');
});

test('shown as each system shows keys', () => {
  assert.equal(label('Alt+Shift+Meta+KeyL', true), '⌥⇧⌘L');
  assert.equal(label('Ctrl+Alt+Shift+KeyL', false), 'Ctrl+Alt+Shift+L');
  assert.equal(label('F6', true), 'F6');
  assert.equal(label('Ctrl+Meta+Digit5', true), '⌃⌘5');
  assert.equal(label('', true), 'None');
});

test('a voice key can be neither typed nor one every app needs', () => {
  assert.equal(problem('KeyL', true), 'Needs ⌘ or ⌃, or an F-key');
  assert.equal(problem('Alt+KeyL', true), 'Needs ⌘ or ⌃, or an F-key', 'macOS won’t give ⌥ alone to a key that works from any app');
  assert.equal(problem('Shift+KeyL', false), 'Needs Ctrl or Alt, or an F-key');
  assert.equal(problem('Meta+KeyC', true), '⌘C is Copy');
  assert.equal(problem('Ctrl+KeyV', false), 'Ctrl+V is Paste');
  assert.equal(problem('Ctrl+Meta+KeyL', false), 'Windows keeps the Windows key for itself');
  assert.equal(problem('F6', true), null);
  assert.equal(problem('Shift+F6', false), null);
  assert.equal(problem('Ctrl+KeyL', true), null);
  assert.equal(problem('Alt+KeyL', false), null);
  assert.equal(parse('Alt+Hyper+KeyL'), null);
  for (const d of Object.entries(DEFAULTS)) for (const k of Object.values(d[1])) assert.equal(problem(k, d[0] === 'mac'), null, k);
});

test('the keys as set: the defaults where nothing usable is', () => {
  assert.deepEqual(voiceKeys(undefined, true), DEFAULTS.mac);
  assert.deepEqual(voiceKeys({}, false), DEFAULTS.other);
  assert.deepEqual(voiceKeys({ listen: 'F6' }, true), { voice: DEFAULTS.mac.voice, listen: 'F6' });
  assert.deepEqual(voiceKeys({ voice: '' }, true), { voice: '', listen: DEFAULTS.mac.listen }, 'none is none');
  assert.deepEqual(voiceKeys({ voice: 'Meta+KeyQ' }, true), DEFAULTS.mac, 'an unusable key is the default');
  const same = voiceKeys({ voice: 'F6', listen: 'F6' }, true);
  assert.notEqual(same.voice, same.listen, 'never one key for both');
});

test('the voice sheet in Getting Started names the default keys', async () => {
  const { VOICE_SHEET } = await import('../../engine/src/welcome.js');
  for (const mac of [true, false]) for (const which of ['voice', 'listen']) {
    const k = label(DEFAULTS[mac ? 'mac' : 'other'][which], mac);
    assert.ok(VOICE_SHEET.includes(k), `the sheet says ${k}`);
  }
});
