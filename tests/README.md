# Tests

Pure-logic tests for the parts of the plugin that do not need a browser or an Unraid box.

    node --test tests/*.test.js

Requires Node >= 18. No dependencies, no `package.json`, no install step.

Use the glob form above, not `node --test tests/` — on Windows the bare directory
argument is resolved as a module path and the run dies with `MODULE_NOT_FOUND`.

These files are **not** packaged — `pkg_build.sh` only copies `src/unraid-folderview/`.

## What is testable here

`scripts/folder-core.js` is the only plugin file this suite can load. It holds the pure,
DOM-free logic shared by `docker.js`, `vm.js` and `dashboard.js`, and it dual-exports:
on an Unraid page it is a classic `<script>` whose declarations become page globals, and
under Node the CommonJS block at its foot makes the same functions `require()`able.

Everything else in `scripts/` touches jQuery, the DOM or Unraid host-page globals at load
time, and everything in `server/` constructs a `DockerClient` or a `Libvirt` connection.
Neither is reachable from here. Logic worth testing therefore has to move into
`folder-core.js` first — that is the point of the file.
