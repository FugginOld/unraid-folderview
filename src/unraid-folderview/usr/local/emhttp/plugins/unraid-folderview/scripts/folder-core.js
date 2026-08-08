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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex, interleaveFoldersLegacy };
}
