const test = require('node:test');
const assert = require('node:assert');
const MODULE_PATH = '../src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js';
const core = require(MODULE_PATH);

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

// --- htmlEscape ---

test('htmlEscape neutralises tag and attribute breakouts', () => {
  assert.strictEqual(core.htmlEscape('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(core.htmlEscape('" onerror="alert(1)'),
    '&quot; onerror=&quot;alert(1)');
  assert.strictEqual(core.htmlEscape("' onload='alert(1)"),
    '&#39; onload=&#39;alert(1)');
  assert.strictEqual(core.htmlEscape('a & b'), 'a &amp; b');
});

test('htmlEscape leaves ordinary folder names alone', () => {
  assert.strictEqual(core.htmlEscape('Media'), 'Media');
  assert.strictEqual(core.htmlEscape('*arr stack'), '*arr stack');
});

test('htmlEscape coerces non-strings without throwing', () => {
  assert.strictEqual(core.htmlEscape(null), '');
  assert.strictEqual(core.htmlEscape(undefined), '');
  assert.strictEqual(core.htmlEscape(0), '0');
  assert.strictEqual(core.htmlEscape(false), 'false');
});

test('htmlEscape is idempotent-safe for the ampersand case', () => {
  // Double-escaping is ugly but not a vulnerability; assert the behaviour so a future
  // change to "escape once" is a deliberate decision rather than an accident.
  assert.strictEqual(core.htmlEscape(core.htmlEscape('<b>')), '&amp;lt;b&amp;gt;');
});

// --- folderLog / folderWarn ---

test('folderLog is silent when the debug flag is off', () => {
  const original = console.log;
  const seen = [];
  console.log = (...a) => seen.push(a);
  try {
    globalThis.FOLDER_VIEW_DEBUG_MODE = false;
    core.folderLog('should not appear');
  } finally { console.log = original; }
  assert.deepStrictEqual(seen, []);
});

test('folderLog forwards every argument when the flag is on', () => {
  const original = console.log;
  const seen = [];
  console.log = (...a) => seen.push(a);
  try {
    globalThis.FOLDER_VIEW_DEBUG_MODE = true;
    core.folderLog('a', 1, { b: 2 });
  } finally {
    console.log = original;
    globalThis.FOLDER_VIEW_DEBUG_MODE = false;
  }
  assert.deepStrictEqual(seen, [['[FV2_DEBUG]', 'a', 1, { b: 2 }]]);
});

test('folderLog reads the flag at call time, not at load time', () => {
  const original = console.log;
  const seen = [];
  console.log = (...a) => seen.push(a);
  try {
    globalThis.FOLDER_VIEW_DEBUG_MODE = false;
    core.folderLog('off');
    globalThis.FOLDER_VIEW_DEBUG_MODE = true;
    core.folderLog('on');
  } finally {
    console.log = original;
    globalThis.FOLDER_VIEW_DEBUG_MODE = false;
  }
  assert.deepStrictEqual(seen, [['[FV2_DEBUG]', 'on']]);
});

test('folderWarn routes to console.warn', () => {
  const original = console.warn;
  const seen = [];
  console.warn = (...a) => seen.push(a);
  try {
    globalThis.FOLDER_VIEW_DEBUG_MODE = true;
    core.folderWarn('careful');
  } finally {
    console.warn = original;
    globalThis.FOLDER_VIEW_DEBUG_MODE = false;
  }
  assert.deepStrictEqual(seen, [['[FV2_DEBUG]', 'careful']]);
});

test('the debug switch defaults to off and is reachable on globalThis', () => {
  // A top-level `const` in a classic script is a global lexical binding: not a property
  // of globalThis and not reassignable. The switch has to be an actual global property
  // or the documented "flip it from the console" workflow cannot work.
  // Clear the flag and re-require so this asserts the module's own doing, not the
  // leftovers of the tests above.
  delete globalThis.FOLDER_VIEW_DEBUG_MODE;
  delete require.cache[require.resolve(MODULE_PATH)];
  require(MODULE_PATH);
  assert.ok(Object.hasOwn(globalThis, 'FOLDER_VIEW_DEBUG_MODE'));
  assert.strictEqual(globalThis.FOLDER_VIEW_DEBUG_MODE, false);
});

test('the debug switch is not clobbered if it was set before load', () => {
  globalThis.FOLDER_VIEW_DEBUG_MODE = true;
  delete require.cache[require.resolve(MODULE_PATH)];
  require(MODULE_PATH);
  assert.strictEqual(globalThis.FOLDER_VIEW_DEBUG_MODE, true);
  globalThis.FOLDER_VIEW_DEBUG_MODE = false;
});
