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

/**
 * Interleave `folder-<id>` placeholders into the live container order.
 *
 * Anchors each folder on a real neighbour rather than on an index offset: a folder goes
 * immediately before the first container that follows it in `prefsOrder` and is actually
 * present in `liveOrder`. This is correct no matter where containers absent from
 * userprefs.cfg happen to sort, which the previous `+ newOnes.length` arithmetic was not —
 * that offset assumed Unraid's front-loading, while the plugin's own readUnraidOrder
 * back-loads them (lib.php:411).
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFolders, htmlEscape };
}
