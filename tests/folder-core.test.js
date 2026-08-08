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

// --- interleaveFolders: the replacement. ---

// The bug: today the plugin's own order source puts unknown containers at the BACK
// (lib.php:411) while Unraid's DOM puts them at the FRONT. The reconciler must not
// depend on which end they land on.
test('new container at the BACK still places the folder correctly', () => {
  const prefs = ['plex', 'folder-F1', 'sonarr'];
  const live  = ['plex', 'sonarr', 'brandnew'];
  const out = core.interleaveFolders(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'folder-F1', 'sonarr', 'brandnew']);
});

test('new container at the FRONT still places the folder correctly', () => {
  const prefs = ['plex', 'folder-F1', 'sonarr'];
  const live  = ['brandnew', 'plex', 'sonarr'];
  const out = core.interleaveFolders(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['brandnew', 'plex', 'folder-F1', 'sonarr']);
});

test('folder whose prefs successors are all gone goes last', () => {
  const prefs = ['plex', 'folder-F1', 'sonarr'];
  const live  = ['plex'];
  const out = core.interleaveFolders(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'folder-F1']);
});

test('two folders keep their relative prefs order', () => {
  const prefs = ['folder-F1', 'plex', 'folder-F2', 'sonarr'];
  const live  = ['plex', 'sonarr'];
  const out = core.interleaveFolders(prefs, live, { F1: {}, F2: {} });
  assert.deepStrictEqual(out, ['folder-F1', 'plex', 'folder-F2', 'sonarr']);
});

test('adjacent folders stay adjacent and ordered', () => {
  const prefs = ['folder-F1', 'folder-F2', 'plex'];
  const live  = ['plex'];
  const out = core.interleaveFolders(prefs, live, { F1: {}, F2: {} });
  assert.deepStrictEqual(out, ['folder-F1', 'folder-F2', 'plex']);
});

test('folder for a deleted id is dropped', () => {
  const prefs = ['plex', 'folder-GONE', 'sonarr'];
  const live  = ['plex', 'sonarr'];
  const out = core.interleaveFolders(prefs, live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'sonarr']);
});

test('empty prefs returns the live order untouched', () => {
  const live = ['plex', 'sonarr'];
  const out = core.interleaveFolders([], live, { F1: {} });
  assert.deepStrictEqual(out, ['plex', 'sonarr']);
  assert.notStrictEqual(out, live, 'must return a new array, not the caller\'s');
});

test('every live container survives, in order', () => {
  const prefs = ['folder-F1', 'a', 'folder-F2', 'b', 'c'];
  const live  = ['x', 'a', 'b', 'c', 'y'];
  const out = core.interleaveFolders(prefs, live, { F1: {}, F2: {} });
  assert.deepStrictEqual(out.filter(n => !core.folderRegex.test(n)), live);
});
