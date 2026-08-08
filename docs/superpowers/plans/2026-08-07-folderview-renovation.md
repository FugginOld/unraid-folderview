# FolderView Renovation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the plugin's security chain, fix the ordering bug that has generated
"folder appears in the wrong place" reports for two years, and leave behind a test
harness so the two large refactors that follow are safe to attempt.

**Architecture:** The plugin is a post-processor for Unraid's Docker/VM/Dashboard tabs —
it lets Unraid render, then relocates DOM nodes into folder rows. Nothing in this plan
changes that decision. What changes: the pure logic (order reconciliation, escaping,
validation) is extracted into a single dependency-free file that loads as a plain
`<script>` in the browser **and** `require()`s under `node --test`, so the parts that
actually carry bugs become testable without an Unraid box.

**Tech Stack:** Vanilla ES2020 browser JS (jQuery available on host pages), PHP 8.2,
Node ≥ 18 for tests only (`node:test` + `node:assert` — no npm dependencies, no
`package.json`).

## Global Constraints

- **No new runtime dependencies.** Tests use Node built-ins only. The shipped plugin
  gains no npm packages, no build step.
- **Tests live at repo root `tests/`, never under `src/`.** `pkg_build.sh` packages
  everything under `src/unraid-folderview/`; anything placed there ships to users.
- **The persisted typo `conatiners` (inside `folder.actions[]`) stays.** It is in users'
  JSON on flash. Renaming it requires a migration that is out of scope here.
- **Both folder-membership labels must keep working:** `unraid-folderview` (new) and
  `folder.view2` (legacy). Users wrote the legacy one into their own `docker-compose.yml`
  files; we do not control those.
- **No top-level `const` collisions.** All three tab scripts (`docker.js`, `dashboard.js`,
  `vm.js`) run as classic scripts sharing one global scope with the host page. Any symbol
  moved into a shared file must be deleted from the file it came from, or the page dies
  with `Identifier '…' has already been declared`.
- **Every task ends with a commit.** No task leaves the tree in a non-loading state.

## Phase Topology

```
A (harness + shared module)  ──┬──►  B (ordering correctness)  ──►  D (debug-log collapse)  ──►  E (two-phase render)  ──►  F (dual-mode core)  ──►  G (settings schema)
                               └──►  C (security hardening)  ─────────────────────────────────┘
```

**A is the blocker.** B, E and F all change index arithmetic that nothing currently
verifies. Attempting any of them before A is how the last two years of ordering
regressions happened.

**B and C are independent of each other and can run in parallel** once A lands. C
touches PHP endpoints and HTML interpolation; B touches order computation. They do not
overlap except that both import from the file A creates.

**Tasks 1–8 (phases A–D) are specified in full below.** Phases E, F and G are specified
at the design level in the appendix — each is large enough to need its own plan document,
written *after* D lands, because their concrete diffs depend on what the harness reveals.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/…/scripts/folder-core.js` | **create** | All pure, DOM-free logic shared by the three tab scripts: order reconciliation, HTML escaping, the `folder-` regex. Dual-exports so Node can `require()` it. |
| `tests/folder-core.test.js` | **create** | `node:test` suite for the above. |
| `tests/README.md` | **create** | How to run the suite (three lines). |
| `src/…/unraid-folderview.Docker.page` | modify | Load `folder-core.js` before `docker.js`. |
| `src/…/unraid-folderview.VMs.page` | modify | Same, before `vm.js`. |
| `src/…/unraid-folderview.Dashboard.page` | modify | Same, before `dashboard.js`. |
| `src/…/scripts/docker.js` | modify | Delete local `folderRegex`; call the shared reconciler; escape interpolations; POST deletes; collapse debug logging. |
| `src/…/scripts/vm.js` | modify | Same. |
| `src/…/scripts/dashboard.js` | modify | Same (renders both types). |
| `src/…/scripts/folderview2.js` | modify | POST deletes with CSRF token. |
| `src/…/scripts/folder.js` | modify | Send CSRF token on create/update. |
| `src/…/server/lib.php` | modify | Whitelist `$type`; validate the Tailscale FQDN; match Unraid's sort for unknown containers. |
| `src/…/server/create.php` `update.php` `delete.php` | modify | CSRF guard; `delete.php` moves GET → POST. |

---

# Phase A — Test harness and shared pure module

**Why first:** nothing in this repo is verified by anything. Phases B, E and F all rewrite
index arithmetic. Doing that unverified is the exact failure mode the changelog records.

---

### Task 1: Shared pure module, loaded on all three tabs

**Files:**
- Create: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`
- Create: `tests/folder-core.test.js`
- Create: `tests/README.md`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/unraid-folderview.Docker.page` (script block, ~line 28)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/unraid-folderview.VMs.page`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/unraid-folderview.Dashboard.page`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js:1703` (delete `folderRegex`)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js:709` (delete `folderRegex`)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js:1282` (delete `folderRegex`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `folderRegex` — `RegExp`, `/^folder-/`. Global on the page; named export under Node.
  - `interleaveFolders(prefsOrder: string[], liveOrder: string[], folders: object): string[]`
    — added in Task 3. Task 1 only ships `folderRegex` so the file has a reason to exist
    and the loading order is proven before logic depends on it.

- [x] **Step 1: Write the failing test**

Create `tests/folder-core.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL — `Cannot find module '../src/…/scripts/folder-core.js'`

- [x] **Step 3: Create the module**

Create `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`:

```js
/**
 * folder-core.js — pure logic shared by docker.js, vm.js and dashboard.js.
 *
 * Hard rules for this file:
 *   - no DOM, no jQuery, no `window`, no network, no host-page globals
 *   - no top-level side effects
 * It is loaded as a classic <script> on the tab pages (so everything here becomes a
 * page global) and require()d by `node --test tests/*.test.js`. The CommonJS export block at
 * the bottom is a no-op in the browser because `module` is undefined there.
 */

/** Matches the `folder-<id>` pseudo-container entries the plugin stores in Unraid's own order list. */
const folderRegex = /^folder-/;

/* eslint-disable no-undef */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 2/2.

- [x] **Step 5: Delete the three duplicate declarations**

In `scripts/docker.js`, delete line 1703:

```js
const folderRegex = /^folder-/;
```

Do the same at `scripts/vm.js:709` and `scripts/dashboard.js:1282`. Delete only the
declaration — every *use* of `folderRegex` stays exactly as it is, because the symbol is
now a page global supplied by `folder-core.js`.

- [x] **Step 6: Load the module on all three tab pages**

All three pages already load `customEvents.js` — the plugin's other shared, page-wide,
non-deferred script — immediately before they pull in user extensions via `custom.php`.
`folder-core.js` goes in that same slot, directly after it:

```php
<script src="/plugins/unraid-folderview/scripts/include/customEvents.js"></script>
<script src="<?php autov('/plugins/unraid-folderview/scripts/folder-core.js')?>"></script>
<?php require_once('/usr/local/emhttp/plugins/unraid-folderview/scripts/custom.php') ?>
```

That exact three-line shape applies to `unraid-folderview.Docker.page:21` and
`unraid-folderview.VMs.page:21`. `unraid-folderview.Dashboard.page:11` has the same
`customEvents.js` line but opens its `custom.php` include with a bare `<?php` on its own
line — insert the new tag after `customEvents.js` there too, leaving that block alone.

Note the new tag has **no `defer`**. `docker.js` is deferred and `vm.js`/`dashboard.js` are
not; a non-deferred classic script placed earlier in the document executes before both
kinds, so `folderRegex` is guaranteed to exist in all three cases. Loading it ahead of
`custom.php` also means user extensions can use it.

`Folder.page` and `FolderView2.page` do **not** get the tag — `folder.js` and
`folderview2.js` never reference `folderRegex`. Revisit if a later phase gives them a
reason to.

- [x] **Step 7: Verify no symbol is declared twice**

Run:

```bash
grep -rn "const folderRegex" src/
```

Expected: exactly one hit, in `scripts/folder-core.js`. Any second hit is a page-breaking
`SyntaxError` waiting to happen.

- [x] **Step 8: Write the runner doc**

Create `tests/README.md`:

```markdown
# Tests

Pure-logic tests for the parts of the plugin that do not need a browser or an Unraid box.

    node --test tests/*.test.js

Requires Node >= 18. No dependencies, no `package.json`, no install step.

Use the glob form above, not `node --test tests/` — on Windows the bare directory
argument is resolved as a module path and the run dies with `MODULE_NOT_FOUND`.

These files are **not** packaged — `pkg_build.sh` only copies `src/unraid-folderview/`.
```

Plus a short section explaining *why* `folder-core.js` is the only loadable file — every
other script touches jQuery or the DOM at load time and every `server/` function
constructs a `DockerClient` or `Libvirt`. See the committed `tests/README.md`.

- [x] **Step 9: Commit**

```bash
git add tests src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/*.page
git commit -m "test: add node test harness and shared folder-core module"
```

---

### Task 2: Characterize the current reconciliation before changing it

**Files:**
- Modify: `tests/folder-core.test.js`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`

**Interfaces:**
- Consumes: `folderRegex` from Task 1.
- Produces: `interleaveFoldersLegacy(prefsOrder, liveOrder, folders): string[]` — a
  faithful, side-effect-free transcription of the arithmetic currently inlined at
  `docker.js:32-43`. It exists to be tested and then **deleted in Task 3**. Do not wire it
  into any tab script.

**Why a throwaway function:** the current logic is four lines buried inside a 130-line
async function that touches jQuery, `MutationObserver` and the network. Transcribing it
first gives a green baseline proving the transcription is faithful, so that when Task 3's
test goes red we know the red is the *bug* and not a transcription slip.

- [x] **Step 1: Write the characterization tests**

Append to `tests/folder-core.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL — `core.interleaveFoldersLegacy is not a function`

- [x] **Step 3: Transcribe the current logic**

Add to `folder-core.js`, above the export block:

```js
/**
 * Transcription of the reconciliation currently inlined at docker.js:32-43.
 * Kept only so its behaviour is pinned by tests before it is replaced. Deleted in Task 3.
 * @param {string[]} prefsOrder values from userprefs.cfg — containers AND `folder-<id>` entries
 * @param {string[]} liveOrder  live container names in the order Unraid rendered them
 * @param {Object}   folders    folder definitions keyed by id
 * @returns {string[]}
 */
function interleaveFoldersLegacy(prefsOrder, liveOrder, folders) {
    const order = [...liveOrder];
    const newOnes = liveOrder.filter(x => !prefsOrder.includes(x));
    for (let index = 0; index < prefsOrder.length; index++) {
        const element = prefsOrder[index];
        if (folderRegex.test(element) && folders[element.slice(7)]) {
            order.splice(index + newOnes.length, 0, element);
        }
    }
    return order;
}
```

Update the export block:

```js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFoldersLegacy };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 6/6. All four characterization tests green — the transcription is faithful
and the offset arithmetic is correct *given its stated premise*.

- [x] **Step 5: Commit**

```bash
git add tests/folder-core.test.js src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js
git commit -m "test: characterize current folder order reconciliation"
```

---

# Phase B — Ordering correctness

**The bug, stated precisely.** Two components disagree about where a container that is
absent from `userprefs.cfg` sorts:

| | Unraid (`DockerContainers.php:37-39`) | Plugin (`lib.php:411`) |
|---|---|---|
| Container absent from prefs | `array_search` → `false` → `0` under `SORT_NUMERIC` → **front** | `$count + count($sort) + 1` → **back** |

`createFolders` uses `key` as **both** an array index and a DOM index
(`docker.js:283` inserts at `$('#docker_list > tr.sortable').eq(key - 1)`). The DOM was
built by Unraid, so it has new containers at the front. The plugin's array has them at the
back. Whenever a container has been created since the last manual drag-order, the two
disagree and the folder row lands in the wrong place.

**Both halves get fixed**, because either alone leaves a hole:

- **B1 (Task 3):** make the JS reconciler anchor on real positions instead of arithmetic,
  so it is correct regardless of where new containers sort. Fully testable in Node.
- **B2 (Task 4):** make `readUnraidOrder` match Unraid, so `liveOrder` actually equals DOM
  order. Required no matter how clever the JS is, because `key` indexes the DOM.

---

### Task 3: Replace offset arithmetic with anchor-based insertion

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`
- Modify: `tests/folder-core.test.js`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js:31-44`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js` (its copy of the same block)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js` (its two copies — docker and vm)

**Interfaces:**
- Consumes: `folderRegex`.
- Produces: `interleaveFolders(prefsOrder: string[], liveOrder: string[], folders: object): string[]`.
  Returns a **new** array: `liveOrder` preserved exactly as a subsequence, with each
  surviving `folder-<id>` entry inserted immediately before the first container that
  follows it in `prefsOrder` and is actually live; folders with no such successor go last.
  `interleaveFoldersLegacy` is deleted by this task.

- [x] **Step 1: Write the failing test**

Append to `tests/folder-core.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL — `core.interleaveFolders is not a function` (8 failures).

- [x] **Step 3: Implement anchor-based insertion**

In `folder-core.js`, **delete** `interleaveFoldersLegacy` entirely and add:

```js
/**
 * Interleave `folder-<id>` placeholders into the live container order.
 *
 * Anchors each folder on a real neighbour rather than on an index offset: a folder goes
 * immediately before the first container that follows it in `prefsOrder` and is actually
 * present in `liveOrder`. This is correct no matter where containers absent from
 * userprefs.cfg happen to sort, which the previous `+ newOnes.length` arithmetic was not.
 *
 * `liveOrder` is preserved exactly as a subsequence of the result — the caller uses the
 * result index as a DOM index, so reordering live containers here would move the wrong row.
 *
 * @param {string[]} prefsOrder values from userprefs.cfg — containers AND `folder-<id>` entries
 * @param {string[]} liveOrder  live container names in the order Unraid rendered them
 * @param {Object}   folders    folder definitions keyed by id; entries with no definition are dropped
 * @returns {string[]} a new array
 */
function interleaveFolders(prefsOrder, liveOrder, folders) {
    const out = [...liveOrder];
    // ponytail: O(prefs x out) scan. n is the container count on one Unraid box (tens),
    // so this runs in microseconds. Index the positions in a Map if it ever isn't.
    for (let i = prefsOrder.length - 1; i >= 0; i--) {
        const entry = prefsOrder[i];
        if (!folderRegex.test(entry) || !folders[entry.slice(7)]) continue;

        // Insert before the nearest following prefs entry that is actually in `out`.
        // Walking prefsOrder backwards means folders inserted on earlier iterations are
        // already in `out`, so folder-before-folder ordering falls out for free.
        let at = out.length;
        for (let j = i + 1; j < prefsOrder.length; j++) {
            const k = out.indexOf(prefsOrder[j]);
            if (k !== -1) { at = k; break; }
        }
        out.splice(at, 0, entry);
    }
    return out;
}
```

Update the export block:

```js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFolders };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 10/10. (The four `interleaveFoldersLegacy` tests from Task 2 are removed
in Step 5 — they will be failing at this point, which is expected.)

- [x] **Step 5: Delete the superseded characterization tests**

Remove the four `legacy:` tests added in Task 2 from `tests/folder-core.test.js`. Their job
— proving the transcription faithful — is done, and `interleaveFoldersLegacy` no longer
exists.

Run: `node --test tests/*.test.js`
Expected: PASS, 10/10, zero failures.

- [x] **Step 6: Call the shared function from `docker.js`**

Replace `docker.js` lines 31-44 (from the `// Filter the order…` comment through the
`if (FOLDER_VIEW_DEBUG_MODE) console.log('[FV2_DEBUG] createFolders: Order after inserting…` line):

```js
    // Interleave the folder placeholders saved in userprefs.cfg into the live order.
    // See folder-core.js — this is pure and covered by tests/folder-core.test.js.
    order = interleaveFolders(unraidOrder, order, folders);
    if (FOLDER_VIEW_DEBUG_MODE) console.log('[FV2_DEBUG] createFolders: Order after inserting Unraid-ordered folders', [...order]);
```

`unraidOrder` is already `JSON.parse(prom[1])` and `order` is already
`Object.values(JSON.parse(prom[3]))` — no other changes needed. Note `newOnes` disappears
as a variable; it is also referenced in the debug-JSON dump around line 68, so replace that
property with `newOnes: order.filter(x => !unraidOrder.includes(x))` to keep the dump
informative, or drop the key.

- [x] **Step 7: Do the same in `vm.js` and `dashboard.js`**

Locate the equivalent `newOnes` / `splice(index + newOnes.length, …)` block in `vm.js` and
**both** copies in `dashboard.js` (it renders docker and vm), and replace each with the
same single `interleaveFolders(...)` call. Find them with:

```bash
grep -rn "newOnes" src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
```

Expected after the edit: no `newOnes.length` arithmetic anywhere.

**Found during execution — a second rewind `docker.js` does not have.** `vm.js:63`,
`dashboard.js:68` and `dashboard.js:176` carry an extra line inside the draw loop:

```js
    key -= createFolder(folders[id], id, key, order, vmInfo, Object.keys(foldersDone));
    key -= newOnes.length;                                    // <- only in vm/dashboard
```

`docker.js` rewinds by the `createFolder` return value alone, which is the only rewind the
loop can justify: `createFolder` splices absorbed members out of `order`, so the cursor
must step back by however many sat before the folder. The second line has no such
justification — it compensated for the `+ newOnes.length` splice offset, and with that
offset gone it is compensating for nothing. It is also cumulative, applying once per folder
drawn, so with three folders and two new VMs it rewound the cursor by six.

It stayed invisible because `newOnes` is empty whenever nothing has been created since the
last manual drag-order, which is most of the time. This is a textbook instance of the
"small fix for VMs" divergence — a hack added to two of the three renderers and never
reconciled.

**Delete all three occurrences**, leaving `vm.js` and `dashboard.js` matching `docker.js`.
This is a real behaviour change on the VMs and Dashboard tabs, so it is called out in Step 9's
on-box verification. The remaining `key -= createFolder(...)` rewind is Phase E's target.

The four debug-JSON dumps still want a `newOnes` value for diagnosis; recompute it inline
there rather than keeping the variable alive:

```js
    newOnes: order.filter(x => !unraidOrder.includes(x)),
```

- [x] **Step 8: Verify locally**

Run:

```bash
grep -rn "newOnes.length" src/
node --check src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js
node --check src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js
node --check src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js
node --test tests/*.test.js
```

Expected: the `grep` returns only the explanatory comment inside `folder-core.js`; all three
`--check` runs are silent; the suite is 10/10.

- [ ] **Step 9: Verify on an Unraid box (manual — covers the deleted rewind)**

Task 3 changes behaviour on all three tabs and the deleted `key -= newOnes.length` changes
it most on VMs and Dashboard. The local suite cannot see any of that.

1. On each of the Docker, VMs and Dashboard tabs: confirm folders render, expand, collapse
   and drag-reorder as before.
2. Create **two or more** folders on the VMs tab and drag them to different positions.
   Refresh — every folder must hold its position. This is the case the deleted cumulative
   rewind distorted, and it needs more than one folder to show up.
3. Create a new container and a new VM, then refresh both tabs. Folders must not shift.
4. Repeat step 2 on the Dashboard, which renders both types through separate code paths.

- [ ] **Step 10: Commit**

```bash
git add tests/folder-core.test.js src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
git commit -m "fix: anchor folder placement on real neighbours instead of index offsets"
```

---

### Task 4: Make `readUnraidOrder` agree with Unraid

> **DEFERRED** — skipped by request, to be batched with the next on-box session. Nothing
> in Phase C or D depends on it. Phase E does: `planLayout`'s output is indexed against the
> DOM Unraid rendered, so this must land before Phase E is verified.

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php:411` (docker branch)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php` (vm branch, the `$count_vms + count($sort) + 1` line)

**Interfaces:**
- Consumes: nothing.
- Produces: `readUnraidOrder(string $type): array` — unchanged signature. Behaviour change:
  entries absent from `userprefs.cfg` now sort to the **front**, matching Unraid, instead of
  the back.

**No unit test.** PHP is not installed on the development machine and the function
constructs a `DockerClient` / `Libvirt` on its first line, so there is nothing to test in
isolation without a mocking layer that would cost more than the fix. Task 3 already removed
the JS's dependency on this ordering; this task closes the remaining DOM-index gap. It is
verified by the on-box check in Step 4.

- [ ] **Step 1: Fix the docker branch**

At `lib.php:411`, replace:

```php
                        $sort[] = ($search === false) ? ($count_containers + count($sort) + 1) : $search;
```

with:

```php
                        // Unraid sorts containers absent from userprefs.cfg to the FRONT:
                        // DockerContainers.php:37-39 feeds array_search()'s `false` straight
                        // into SORT_NUMERIC, where it evaluates to 0. Match that exactly — the
                        // caller uses this array's indices as DOM indices against the table
                        // Unraid rendered, so any disagreement moves the wrong row.
                        // PHP >= 8.0 sorts are stable, so equal keys keep docker's listing order.
                        $sort[] = ($search === false) ? 0 : $search;
```

`$count_containers` is now unused in this branch — delete its assignment
(`$count_containers = count($containersFromUnraid);`).

- [ ] **Step 2: Fix the vm branch**

In the `elseif ($type == "vm")` branch, replace:

```php
                            $sort[] = ($search === false) ? ($count_vms + count($sort) + 1) : $search;
```

with:

```php
                            $sort[] = ($search === false) ? 0 : $search;
```

and delete the now-unused `$count_vms = count($vms);`.

- [ ] **Step 3: Verify the file still parses**

PHP is not available locally. Confirm the edit did not break the syntax by eye — the change
is one expression per branch — then let Step 4 be the real check. If PHP is available on
any machine you have:

```bash
php -l src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php
```

Expected: `No syntax errors detected`

- [ ] **Step 4: Verify on an Unraid box (manual — this is the actual test)**

1. Install the built package on a test Unraid server.
2. Create a folder on the Docker tab and drag it into the middle of the list. Refresh —
   confirm it holds position.
3. Create a **new** container (any image, `docker run -d --name zzztest alpine sleep 999`).
4. Refresh the Docker tab.
5. **Expected:** the folder is still exactly where you left it, and `zzztest` appears at the
   top of the list (Unraid's placement for a container with no saved order).
   **Before this fix:** the folder shifts by one position per new container.
6. Press the debug keystroke to dump `debug-DOCKER.json` and confirm the containers listed
   in `originalOrder` but absent from `unraidOrder` appear at the *start* of `originalOrder`.
7. Repeat steps 2-5 on the VMs tab with a newly-defined VM.

- [ ] **Step 5: Commit**

```bash
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php
git commit -m "fix: sort prefs-less containers to the front, matching Unraid"
```

---

# Phase C — Security hardening

Three gaps compose into one remotely-reachable stored-XSS chain against a root-privileged
UI: no CSRF token on the mutating endpoints (and `delete.php` mutating on `GET`), an
unvalidated `type` reaching a filesystem path *including the write primitive*, and a
rendering layer that builds every row by string concatenation with no escaping. Session
auth is not a mitigation — CSRF is precisely the attack where the victim's session is
already valid.

**Runs in parallel with Phase B.** It depends on Phase A only for `folder-core.js`.

---

### Task 5: Whitelist `$type` and validate the Tailscale FQDN

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php:61-67` (`fv2_get_tailscale_fqdn_from_container`)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php:73-116` (`readFolder`, `updateFolder`, `deleteFolder`, `createFile`)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php` (`readInfo`, `readUnraidOrder` entry points)

**Interfaces:**
- Consumes: nothing.
- Produces: `fv2_valid_type(string $type): bool` — `true` only for `docker` and `vm`.

- [x] **Step 1: Add the type guard**

In `lib.php`, immediately above `function readFolder(...)`:

```php
    /**
     * The only two values `type` may ever take. It is used to build filesystem paths
     * ("$configDir/$type.json") in five functions including createFile(), which is the
     * write primitive reachable from the read path. readUserPrefs() already whitelists
     * correctly; this applies the same pattern everywhere else.
     */
    function fv2_valid_type(string $type) : bool {
        return in_array($type, ['docker', 'vm'], true);
    }
```

- [x] **Step 2: Apply it at every path-building site**

`readFolder` — refuse rather than read an arbitrary path:

```php
    function readFolder(string $type) : string {
        global $configDir;
        if(!fv2_valid_type($type)) { return '{}'; }
        if(!file_exists("$configDir/$type.json")) { createFile($type); }
        return file_get_contents("$configDir/$type.json");
    }
```

`updateFolder` and `deleteFolder` — refuse rather than write:

```php
    function updateFolder(string $type, string $content, string $id = '') : void {
        global $configDir;
        if(!fv2_valid_type($type)) { return; }
        // …rest unchanged…
    }

    function deleteFolder(string $type, string $id) : void {
        global $configDir;
        if(!fv2_valid_type($type)) { return; }
        // …rest unchanged…
    }
```

`createFile` — the write primitive, guarded even though its callers are now guarded too
(defence in depth costs one line here):

```php
    function createFile(string $type): void {
        global $configDir;
        if(!fv2_valid_type($type)) { return; }
        if (!is_dir($configDir)) { @mkdir($configDir, 0770, true); }
        $default = ['docker' => '{}', 'vm' => '{}'];
        @file_put_contents("$configDir/$type.json", $default[$type] ?? '{}');
    }
```

`readInfo` and `readUnraidOrder` — both already branch on `$type == 'docker'` /
`$type == 'vm'` and fall through to an empty result, so they are safe as written. Add the
explicit guard at the top of each anyway so the invariant is stated once per entry point:

```php
        if(!fv2_valid_type($type)) { return []; }
```

- [x] **Step 3: Validate the Tailscale FQDN at source**

At `lib.php:63-66`, replace:

```php
            if (isset($status_data['Self']['DNSName'])) {
                $dnsName = rtrim($status_data['Self']['DNSName'], '.');
                fv2_debug_log("    fv2_get_tailscale_fqdn_from_container: Found DNSName for $containerName: " . $dnsName);
                return $dnsName;
            }
```

with:

```php
            if (isset($status_data['Self']['DNSName'])) {
                $dnsName = rtrim((string) $status_data['Self']['DNSName'], '.');
                // This value comes back from `docker exec <ct> tailscale status --json` —
                // i.e. it is supplied by the container — and lands in an href in all three
                // renderers. Its IPv4 sibling twenty lines up validates with
                // FILTER_VALIDATE_IP; this one validated nothing.
                if (filter_var($dnsName, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false) {
                    fv2_debug_log("    fv2_get_tailscale_fqdn_from_container: Rejected non-hostname DNSName for $containerName: " . $dnsName);
                    return null;
                }
                fv2_debug_log("    fv2_get_tailscale_fqdn_from_container: Found DNSName for $containerName: " . $dnsName);
                return $dnsName;
            }
```

- [x] **Step 4: Verify no unguarded path build remains**

Run:

```bash
grep -n 'configDir/\$type' src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php
```

Expected: every hit is inside a function whose first statement is a `fv2_valid_type` guard.
Cross-check by eye against the list in Step 2.

- [x] **Step 5: Commit**

```bash
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php
git commit -m "fix(security): whitelist type at every path site, validate tailscale FQDN"
```

---

### Task 6: CSRF-guard the mutating endpoints

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/lib.php` (add guard helper)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/create.php`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/update.php`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/delete.php`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder.js:281,283`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folderview2.js:64,67,101,104,127,144,173,190`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js:1139`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js:417`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js:641,666`

**Interfaces:**
- Consumes: `csrf_token` — a page global Unraid already defines. The plugin already relies
  on it at `docker.js:1383`, `dashboard.js:775`, `dashboard.js:1080` and `vm.js:586`, so
  this introduces no new dependency.
- Produces: `fv2_require_csrf(): void` — exits 403 unless the request carries a valid token.

- [x] **Step 1: Add the guard helper**

In `lib.php`, after `fv2_valid_type`:

```php
    /**
     * Reject any request without Unraid's CSRF token. These endpoints run as root and
     * mutate files on the flash drive; session auth alone does not protect them, because
     * CSRF is exactly the attack in which the victim's session is already valid.
     * Terminates the request on failure — callers do not need to check a return value.
     */
    function fv2_require_csrf() : void {
        $var = @parse_ini_file('/var/local/emhttp/var.ini');
        $expected = $var['csrf_token'] ?? '';
        $given = $_POST['csrf_token'] ?? '';
        if ($expected === '' || !is_string($given) || !hash_equals($expected, $given)) {
            http_response_code(403);
            exit('Forbidden');
        }
    }
```

- [x] **Step 2: Guard the three endpoints, and move `delete` off GET**

`create.php`:

```php
<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    fv2_require_csrf();
    updateFolder($_POST['type'] ?? '', $_POST['content'] ?? '');
?>
```

`update.php`:

```php
<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    fv2_require_csrf();
    updateFolder($_POST['type'] ?? '', $_POST['content'] ?? '', $_POST['id'] ?? '');
?>
```

`delete.php` — note this changes the method from `GET` to `POST`; a `GET` that mutates is
reachable from an `<img src>` on any page the admin visits:

```php
<?php
    require_once("/usr/local/emhttp/plugins/unraid-folderview/server/lib.php");
    fv2_require_csrf();
    deleteFolder($_POST['type'] ?? '', $_POST['id'] ?? '');
?>
```

- [x] **Step 3: Send the token from all twelve client call sites**

Three `create`/`update` sites gain one field. `folder.js:281,283`:

```js
    if (folderId) {
        await $.post('/plugins/unraid-folderview/server/update.php', { type: type, content: JSON.stringify(folder), id: folderId, csrf_token: csrf_token });
    } else {
        await $.post('/plugins/unraid-folderview/server/create.php', { type: type, content: JSON.stringify(folder), csrf_token: csrf_token });
    }
```

`folderview2.js:64,67,101,104` — same pattern, adding `csrf_token: csrf_token` to each
existing `$.post` payload object.

Six `delete` sites change verb *and* payload. `docker.js:1139`:

```js
        await $.post('/plugins/unraid-folderview/server/delete.php', { type: 'docker', id: id, csrf_token: csrf_token }).promise();
```

Apply the same shape at `vm.js:417` (`type: 'vm'`), `dashboard.js:641` (`'docker'`),
`dashboard.js:666` (`'vm'`), `folderview2.js:127` and `:144` (`'docker'`, the latter using
`cid`), `folderview2.js:173` and `:190` (`'vm'`).

- [x] **Step 4: Verify no GET-based delete survives**

Run:

```bash
grep -rn "delete.php?" src/
```

Expected: no output. Every hit means a call site was missed and folder deletion will
silently 403 there.

Then:

```bash
grep -rn "server/\(create\|update\|delete\).php" src/ | grep -v csrf_token
```

Expected: no output.

- [ ] **Step 5: Verify the guard on an Unraid box (manual)**

1. Install the build. Create, rename and delete a folder on the Docker tab — all three must
   still work.
2. Repeat on the VMs tab and from Settings → Utilities → FolderView.
3. From a shell on the server, confirm the guard bites:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost/plugins/unraid-folderview/server/delete.php -d 'type=docker&id=whatever'
   ```
   Expected: `403`

- [ ] **Step 6: Commit**

```bash
git add src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/server/ src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
git commit -m "fix(security): require CSRF token on mutating endpoints, POST-only delete"
```

---

### Task 7: Escape untrusted values at the HTML sinks

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`
- Modify: `tests/folder-core.test.js`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js:270` (folder row), `:770` (label icon), `:793` (Tailscale href)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js` (its equivalents, both types)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js` (its equivalents)

**Interfaces:**
- Consumes: `folderRegex` (unchanged).
- Produces: `htmlEscape(value: any): string` — `null`/`undefined` become `''`, everything
  else is stringified with `& < > " '` replaced by entities. Safe for both text content and
  quoted attribute values.

**Which sinks matter, and why:**

| Sink | Source | Why escape |
|---|---|---|
| `folder.name`, `folder.icon` | the folder form | **Attacker-reachable** through the CSRF gap Task 6 closes. This is the stored-XSS half of the chain. |
| `ct.Labels['net.unraid.docker.icon']` | an arbitrary docker image label | Untrusted string reaching an `img src`. |
| `ct.info.State.TSWebUi` | container-supplied Tailscale `DNSName` | Task 5 validates it at source; escaping here is the second layer. |
| `ct.info.Name` | docker container name | Docker constrains names to `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Escape anyway — it costs nothing and removes the need to re-derive that argument later. |

- [x] **Step 1: Write the failing test**

Append to `tests/folder-core.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL — `core.htmlEscape is not a function` (4 failures).

- [x] **Step 3: Implement it**

Add to `folder-core.js`:

```js
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape a value for interpolation into an HTML template literal — safe for text content
 * and for double- or single-quoted attribute values alike.
 *
 * Every row, preview and tooltip in this plugin is built by string concatenation, so this
 * has to be applied at the interpolation site; there is no framework doing it for us.
 *
 * @param {*} value
 * @returns {string}
 */
function htmlEscape(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
```

Update the export block:

```js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFolders, htmlEscape };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 14/14.

- [x] **Step 5: Apply it at the folder-row sink**

In `docker.js:270`, the `fld` template literal. Wrap the two attacker-reachable values:

```js
    const fld = `<tr class="sortable folder-id-${id} ${folder.settings.preview_hover ? 'hover' : ''} folder"><td class="ct-name folder-name"><div class="folder-name-sub"><i class="fa fa-arrows-v mover orange-text"></i><span class="outer folder-outer"><span id="${id}" onclick="addDockerFolderContext('${id}')" class="hand folder-hand"><img src="${htmlEscape(folder.icon)}" class="img folder-img" onerror='this.src="/plugins/dynamix.docker.manager/images/question.png"'></span><span class="inner folder-inner"><span class="appname" style="display: none;"><a>folder-${id}</a></span><a class="exec folder-appname" onclick='editFolder("${id}")'>${htmlEscape(folder.name)}</a><br>…
```

Only `folder.icon` and `folder.name` change; the rest of the literal is untouched. `id` is
a 20-character value from `generateId()` (base64 with `+/=` stripped, so alphanumeric only)
and is safe as written.

- [x] **Step 6: Apply it at the tooltip sinks**

`docker.js:770`:

```js
                                    <div class="preview-img"><img src="${htmlEscape(ct.Labels['net.unraid.docker.icon'] || '')}" class="img folder-img" onerror='this.src="/plugins/dynamix.docker.manager/images/question.png"'></div>
```

`docker.js:772` (container name into text content):

```js
                                        <span class="blue-text appname">${htmlEscape(ct.info.Name)}</span><br>
```

`docker.js:793` (Tailscale URL into an `href`):

```js
                                     ${ct.info.State.TSWebUi ? `<li><a href="${htmlEscape(ct.info.State.TSWebUi)}" target="_blank"><i class="fa fa-shield" aria-hidden="true"></i> ${$.i18n('tailscale-webui')}</a></li>` : ''}
```

The adjacent `ct.info.State.WebUi` href gets the same treatment — it is assembled in
`lib.php` from template placeholders and container network data, not from a constant.

- [x] **Step 7: Apply it in `vm.js` and `dashboard.js`**

Both files carry near-identical template literals. Find the interpolation sites:

```bash
grep -n 'folder.icon\|folder.name\|net.unraid.docker.icon\|TSWebUi\|ct.info.Name' \
  src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js \
  src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js
```

Wrap each in `htmlEscape(...)`. `dashboard.js` has two sets — one for docker, one for VMs;
do both. VM equivalents of `ct.info.Name` are the domain name from libvirt.

- [x] **Step 8: Verify no sink was missed**

Run this, which catches any quoted attribute sink regardless of which value feeds it:

```bash
grep -on '\(src\|href\)="${[^}]*}"' src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/*.js | grep -v htmlEscape
grep -on '>${folder\.name}<\|>${ct\.info\.Name}<' src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/*.js
```

Expected: no output from either — every hit would be an unescaped sink.

**Found during execution — the sink surface is 19, not the 8 the table above implies.**
`docker.js` puts five more untrusted values into `href` attributes that the table did not
name, all from the XML template or docker labels, i.e. the same trust level as `WebUi`:

| Line | Value |
|---|---|
| `docker.js:798` | `ct.info.ReadMe` |
| `docker.js:799` | `ct.info.Project` |
| `docker.js:800` | `ct.info.Support` |
| `docker.js:801`, `:808` | `ct.info.registry` (two sinks) |
| `docker.js:802` | `ct.info.DonateLink` |
| `docker.js:885` | a second `ct.info.State.WebUi` |

This is what commit `52b4f7c` ("widen the XSS finding to the full sink surface") was
pointing at. Escape all of them — the grep above is the authority, not the table.

All five are wrapped in truthiness guards (`${ct.info.ReadMe ? \`…\` : ''}`), so
`htmlEscape`'s `undefined → ''` coercion changes nothing about what renders.

`dashboard.js` and `vm.js` have **no** per-container tooltip sinks — only their folder
rows (`dashboard.js:245` and `:433`, `vm.js:127`). Do not go looking for tooltip
equivalents there; they do not exist.

- [ ] **Step 9: Verify on an Unraid box (manual)**

1. Create a folder literally named `<img src=x onerror=alert(1)>`.
2. Reload the Docker tab, the VMs tab and the Dashboard.
3. **Expected:** the name renders as visible literal text in all three places. No dialog.
4. Confirm the folder still opens, expands, renames and deletes normally — escaping must
   not have broken the `onclick='editFolder("…")'` handler next to it.

- [ ] **Step 10: Commit**

```bash
git add tests/folder-core.test.js src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
git commit -m "fix(security): escape untrusted values at every HTML interpolation site"
```

---

# Phase D — Collapse debug logging

Roughly 290 of `docker.js`'s 1,752 lines are `if (FOLDER_VIEW_DEBUG_MODE) console.log(...)`
— about one line in six, interleaved with the logic they describe, and dead in every
shipped build. This phase is scheduled **before** the two large refactors rather than after
because it removes ~17% of the lines those refactors have to read, move and re-review.

---

### Task 8: Replace the guarded-log idiom with a `log()` helper

**Files:**
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/folder-core.js`
- Modify: `tests/folder-core.test.js`
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js` (throughout)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/dashboard.js` (throughout)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/vm.js` (throughout)
- Modify: `src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js:206-210` (delete dead per-folder debug block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `folderLog(...args): void` — forwards to `console.log` only when
    `window.FOLDER_VIEW_DEBUG_MODE` is truthy. No-op otherwise.
  - `folderWarn(...args): void` — same, forwarding to `console.warn`.

  Both read the flag at *call* time, not load time, so it can be flipped from the browser
  console without a reload — which is the only reason anyone turns it on.

- [ ] **Step 1: Write the failing test**

Append to `tests/folder-core.test.js`:

```js
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
  assert.deepStrictEqual(seen, [['a', 1, { b: 2 }]]);
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
  assert.deepStrictEqual(seen, [['on']]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL — `core.folderLog is not a function` (3 failures).

- [ ] **Step 3: Implement the helpers**

Add to `folder-core.js`:

```js
/**
 * Debug logging. Reads globalThis.FOLDER_VIEW_DEBUG_MODE on every call so it can be
 * toggled from the browser console mid-session — the only time anyone wants it.
 */
function folderLog(...args) {
    if (globalThis.FOLDER_VIEW_DEBUG_MODE) console.log('[FV2_DEBUG]', ...args);
}

function folderWarn(...args) {
    if (globalThis.FOLDER_VIEW_DEBUG_MODE) console.warn('[FV2_DEBUG]', ...args);
}
```

Update the export block:

```js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFolders, htmlEscape, folderLog, folderWarn };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 17/17.

- [ ] **Step 5: Convert the call sites in `docker.js`**

The existing idiom is one of these two shapes:

```js
    if (FOLDER_VIEW_DEBUG_MODE) console.log('[FV2_DEBUG] createFolders: Entry');
    if (FOLDER_VIEW_DEBUG_MODE) console.warn(`[FV2_DEBUG] createFolders: Folder ${id} not found.`);
```

Each becomes one call with the guard and the prefix removed:

```js
    folderLog('createFolders: Entry');
    folderWarn(`createFolders: Folder ${id} not found.`);
```

Multi-line blocks collapse the same way — this:

```js
    if (FOLDER_VIEW_DEBUG_MODE) {
        console.log('[FV2_DEBUG] createFolders: --- INITIAL ORDERS ---');
        console.log('[FV2_DEBUG] createFolders: Raw `unraidOrder`:', JSON.parse(JSON.stringify(unraidOrder)));
        console.log('[FV2_DEBUG] createFolders: --- END INITIAL ORDERS ---');
    }
```

becomes:

```js
    folderLog('createFolders: orders in', { unraidOrder, order, folders });
```

Note the `JSON.parse(JSON.stringify(x))` deep-copies exist to defeat the browser console's
live-object rendering. Keep that trick only where the object is mutated later in the same
function — `unraidOrder`, `order` and `folders` in `createFolders` qualify:

```js
    folderLog('createFolders: orders in', JSON.parse(JSON.stringify({ unraidOrder, order, folders })));
```

Keep `const FOLDER_VIEW_DEBUG_MODE = false;` at `docker.js:1` — it is the documented switch,
and `folderLog` reads it off the global scope where that declaration puts it.

- [ ] **Step 6: Delete the dead per-folder debug block**

`docker.js:206-210` is debug code keyed to one specific folder ID from the original author's
own server. Delete it outright.

- [ ] **Step 7: Convert `vm.js` and `dashboard.js`**

Same mechanical conversion. Find every remaining site:

```bash
grep -rn "FOLDER_VIEW_DEBUG_MODE" src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
```

Expected after the sweep: exactly three hits — the `const FOLDER_VIEW_DEBUG_MODE = false;`
declaration at the top of each of the three scripts. Every other hit is an unconverted site.

- [ ] **Step 8: Verify nothing else changed**

Run: `node --test tests/*.test.js`
Expected: PASS, 17/17.

Then confirm the line count actually dropped:

```bash
wc -l src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/docker.js
```

Expected: roughly 1,450-1,500, down from 1,752. A number close to 1,752 means the sweep was
incomplete.

- [ ] **Step 9: Verify on an Unraid box (manual)**

1. Load the Docker tab. Console must be clean — no `[FV2_DEBUG]` output.
2. In the console run `FOLDER_VIEW_DEBUG_MODE = true`, then refresh the container list
   (without reloading the page). `[FV2_DEBUG]` lines must appear.
3. Set it back to `false`; output stops.
4. Confirm folders still render, expand, collapse and reorder on all three tabs.

- [ ] **Step 10: Commit**

```bash
git add tests/folder-core.test.js src/unraid-folderview/usr/local/emhttp/plugins/unraid-folderview/scripts/
git commit -m "refactor: collapse guarded debug logging into folderLog helper"
```

---

# Appendix — Phases E, F, G

These three are the structural work. Each needs its own plan document, written after the
preceding phase lands, because their concrete diffs depend on what the harness and the
earlier cleanups reveal. What follows is the locked design and the acceptance criteria for
each — enough to start the plan, not enough to skip writing one.

---

## Phase E — Two-phase render

**Depends on:** A, B, D.

**The problem.** `createFolders` iterates the order array while `createFolder` splices
entries out of that same array, so every absorbed container sitting *before* the folder's
slot shifts the parent loop's cursor. The child returns a count (`remBefore`) and the parent
rewinds `key` by it (`docker.js:124-126`). It works, but it is index arithmetic over a
live-mutated array with a DOM write in the middle, and the changelog records at least six
bugs traceable to it. Phase B fixed *where folders go*; this fixes *the mechanism that puts
them there*.

**The design.**

```
planLayout(folders, prefsOrder, liveOrder, containersInfo) -> LayoutPlan   // pure, testable
applyLayout(plan)                                                          // all DOM writes
```

`LayoutPlan` is a plain array of row descriptors, one per visible row, in final order:

```js
[ { kind: 'container', name: 'plex' },
  { kind: 'folder', id: 'F1', members: ['sonarr','radarr'], state: { running: 1, total: 2, update: false, autostart: true, managed: true } },
  { kind: 'container', name: 'unraid-api' } ]
```

Phase one computes membership (explicit ∪ regex ∪ label, both label names), resolves the
ordering, and folds each folder's aggregate state — with no DOM access at all. Phase two
walks the finished plan and performs the moves. There is no cursor to rewind because
nothing mutates while anything iterates.

**Acceptance:**
- `planLayout` is exported from `folder-core.js` and covered by tests including: a container
  before its folder, two folders with interleaved members, a member matched by regex only, a
  member matched by the legacy `folder.view2` label only, a member claimed by two folders,
  an empty folder, and a folder whose every member has disappeared.
- `remBefore` and the `key -= …` rewind no longer exist anywhere in `src/`.
- On-box: folders render identically to the pre-refactor build in all three tabs, including
  the case that used to break — a container ordered immediately before a folder that absorbs
  it.

---

## Phase F — Dual-mode core plus three adapters

**Depends on:** E.

**The problem.** `docker.js` (≈1,450 after Phase D), `dashboard.js` (≈1,100) and `vm.js`
(≈650) implement the same lifecycle three times, and `dashboard.js` does it twice
internally, once per type. That is roughly 3,200 lines carrying perhaps 1,400 lines of
distinct behaviour. The differences are real — different DOM targets, different action
endpoints, different intercept points — but they are *parameters*, not architecture. Today
every fix must be found and applied in three or four places, and the ones that get missed
are exactly the recurring "small fix for VMs" changelog entries.

**The design.** One `folderEngine(config)` where `config` supplies:

| Key | Docker | VM | Dashboard |
|---|---|---|---|
| `type` | `'docker'` | `'vm'` | both, engine instantiated twice |
| `tableSelector` | `#docker_containers` | VM table | dashboard containers |
| `rowSelector` | `#docker_list > tr.sortable` | … | … |
| `intercept` | patch `window.loadlist` / `window.listview` | `$.ajaxPrefilter` on `VMMachines.php` | `$.ajaxPrefilter` on `DashboardApps.php` |
| `actionEndpoint` | `eventURL` (host global) | its own declared URL | per type |
| `eventPrefix` | `docker-` | `vm-` | dispatches both families |

"Dual-mode" is the requirement that the engine be instantiable twice on one page, because
the Dashboard renders both types simultaneously. That rules out module-level mutable state —
`loadedFolder`, `folderobserver` and the request array must all become instance state.

**Acceptance:**
- All thirteen `docker-*` and nine `vm-*` events still fire, with the same names, the same
  ordering, and `detail` still carrying **live** object references — the extension contract
  in `dev/README.md` is unchanged and the templates in `dev/` still work unmodified.
- `dashboard.js` instantiates the engine twice and shares no mutable state between them.
- Total across the three scripts drops below 2,000 lines.
- On-box: every tab behaves identically, and the `dev/` example extensions load and mutate
  as documented.

---

## Phase G — Declared settings schema

**Depends on:** F.

**The problem.** `folder.settings` is a flat bag of ~20 fields with no schema, read
everywhere as `folder.settings?.x || default`. The defaults are scattered across every read
site instead of stated once. It has survived two years of additions without a migration
precisely *because* every consumer defaults each missing field independently — that is the
feature, and it must not be lost.

**The design.** One `FOLDER_SETTINGS_DEFAULTS` object in `folder-core.js` and one
`withDefaults(folder)` applied at the point folder JSON enters the engine. Read sites then
use `folder.settings.x` directly. The merge stays shallow and additive: an unknown field in
a user's JSON is preserved untouched, and a missing field gets the default — so a folder
written by a 2023 build still loads, exactly as today.

This also creates the one place a real migration can live when one is eventually needed —
including for the persisted `conatiners` typo, which Phase G does *not* touch.

**Acceptance:**
- Every `settings?.` / `|| default` pair is gone from the three tab scripts.
- Tests cover: a folder with no `settings` key at all, a folder with a partial `settings`
  bag, and a folder carrying an unknown extra field (which must survive a load/save round
  trip unmodified).
- On-box: a `docker.json` copied from an old install renders with the same appearance and
  behaviour before and after.

---

## Self-Review

**Spec coverage.** Every item recorded as in-scope maps to a task:

| Requirement | Task |
|---|---|
| Test harness (the blocker) | 1, 2 |
| `readUnraidOrder`/`createFolders` offset contradiction | 3 (JS), 4 (PHP) |
| `in_array` strict type whitelist | 5 |
| FQDN validation | 5 |
| CSRF token | 6 |
| POST-not-GET on delete | 6 |
| `htmlEscape` at the sinks | 7 |
| Two-phase render | Phase E (appendix) |
| Dual-mode cores | Phase F (appendix) |
| Red-green test mandate | Tasks 1-3, 7, 8 each open with a failing test |
| A/B‖C topology | Phase Topology, above |

**Known limits, stated rather than hidden.**

- **Phase A cannot test PHP.** PHP is not installed on the development machine, and
  `lib.php` constructs a `DockerClient` and a `Libvirt` connection at the top of the
  functions worth testing. Task 4's verification is therefore an on-box procedure, not an
  assertion. That is a real gap; the mitigation is that Task 3 removed the JS's dependence
  on the PHP ordering, so the PHP fix now only has to be right about *one* thing (DOM index
  parity) rather than two.
- **Phases E, F and G are specified, not planned.** Writing bite-sized TDD steps for a
  3,200-to-1,400-line refactor before the harness exists would be fabrication. Each gets its
  own plan document once its predecessor lands.
- **Manual on-box verification appears in Tasks 4, 6, 7 and 8.** Nothing in this repo runs
  outside an Unraid server, so DOM behaviour cannot be asserted in CI. Those steps are
  written as explicit procedures with expected results rather than as "test it works".

**Type consistency.** `folder-core.js` exports across tasks: `folderRegex` (Task 1),
`interleaveFoldersLegacy` (Task 2, deleted in Task 3), `interleaveFolders` (Task 3),
`htmlEscape` (Task 7), `folderLog` / `folderWarn` (Task 8). The export block is rewritten in
full at each task that adds to it, so no task leaves a stale export list.
