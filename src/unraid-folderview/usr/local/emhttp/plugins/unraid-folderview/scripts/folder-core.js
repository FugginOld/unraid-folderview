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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { folderRegex };
}
