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
