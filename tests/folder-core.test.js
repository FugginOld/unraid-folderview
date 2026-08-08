const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js');

test('folderRegex matches folder placeholders only', () => {
  assert.ok(core.folderRegex.test('folder-Ax7Kq2mNp9RtVw3ZcYb1'));
  assert.ok(!core.folderRegex.test('plex'));
  assert.ok(!core.folderRegex.test('my-folder-thing'));
});

test('the 7-character slice used to recover a folder id is correct', () => {
  assert.strictEqual('folder-abc123'.slice(7), 'abc123');
});

// --- Characterization of the arithmetic currently inlined at docker.js:32-43. ---
// These pin the existing behaviour so that when the replacement in Task 3 goes red we
// know the red is the bug and not a transcription slip. Deleted along with
// interleaveFoldersLegacy once interleaveFolders lands.

test('legacy: folder placed correctly when nothing is new', () => {
  const prefs = ['plex', 'folder-F1', 'sonarr', 'radarr'];
  const live  = ['plex', 'sonarr', 'radarr'];
  const out = core.interleaveFoldersLegacy(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'folder-F1', 'sonarr', 'radarr']);
});

test('legacy: folder for an id that no longer exists is dropped', () => {
  const prefs = ['plex', 'folder-GONE', 'sonarr'];
  const live  = ['plex', 'sonarr'];
  const out = core.interleaveFoldersLegacy(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'sonarr']);
});

test('legacy: two folders keep their relative prefs order', () => {
  const prefs = ['folder-F1', 'plex', 'folder-F2', 'sonarr'];
  const live  = ['plex', 'sonarr'];
  const out = core.interleaveFoldersLegacy(prefs, live, { F1: {}, F2: {} });
  assert.deepStrictEqual(out, ['folder-F1', 'plex', 'folder-F2', 'sonarr']);
});

// This is the documented premise of the `+ newOnes.length` offset: Unraid sorts
// containers that are absent from userprefs.cfg to the FRONT of the list.
test('legacy: correct when new containers arrive at the FRONT (Unraid behaviour)', () => {
  const prefs = ['plex', 'folder-F1', 'sonarr'];
  const live  = ['brandnew', 'plex', 'sonarr'];
  const out = core.interleaveFoldersLegacy(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['brandnew', 'plex', 'folder-F1', 'sonarr']);
});
