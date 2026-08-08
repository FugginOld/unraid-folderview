# CONTEXT.md

Orientation for anyone (human or agent) picking up this repo. For how the code is
put together, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. What this is

**FolderView2** is an Unraid 7 web-UI plugin that adds *folders* to the Docker and
VMs tabs and to the Dashboard. You group containers/VMs into a folder, the folder
collapses into a single row, and you can act on the whole group at once (start,
stop, pause, restart, update, or run a User Script).

The problem it solves is mundane and real: a Docker tab with 40 containers —
common once you run docker-compose stacks or an *arr suite — is an unreadable
wall of rows. Unraid ships no grouping primitive. FolderView2 adds one *without*
Unraid's cooperation: it hooks the stock page after render and rearranges the DOM.

**It is a UI-layer plugin. It owns no container state.** Every action is forwarded to
Unraid's own endpoints — Docker actions go to whatever URL the host page's `eventURL`
global points at (`dynamix.docker.manager/include/Events.php`), VM actions to
`VMajax.php`, and custom script actions to the third-party **User Scripts** plugin's
`exec.php`. Uninstalling changes nothing about your containers.

**Uninstalling does, however, delete all your folder definitions.** The remove block
in [folder.view2.plg:311-317](folder.view2.plg#L311-L317) runs
`rm -rf /boot/config/plugins/folder.view2`, which takes `docker.json`, `vm.json`,
*and* the user's `scripts/` and `styles/` extensions with it. Export first — see §7.

### Lineage — read this before you get confused by names

| Thing | Value |
|---|---|
| This git repo | `FugginOld/unraid-folderview` (directory: `unraid-folderview`) |
| Plugin ID / package name | `folder.view2` |
| Upstream this forked from | [VladoPortos/folder.view2](https://github.com/VladoPortos/folder.view2) |
| Original author | [scolcipitato/folder.view](https://github.com/scolcipitato/folder.view) |

Three different names are in play. The repo directory name is **not** the plugin
name — everything on disk, in URLs, and in config paths is `folder.view2`. The
`.plg` manifest still points at **VladoPortos**' repo, not this one (see §7).

---

## 2. Runtime environment — the part that surprises people

Unraid's web UI (`emhttp`) is a PHP application whose plugin directory lives on a
**RAM disk**. This drives almost every odd decision in the repo.

```
/usr/local/emhttp/plugins/folder.view2/   ← RAM disk. Wiped on every reboot.
                                            Rebuilt at boot from the .txz on flash.
/boot/config/plugins/folder.view2/        ← USB flash. The only persistent storage.
    docker.json    ← all Docker folder definitions
    vm.json        ← all VM folder definitions
    version        ← installed version string
    scripts/       ← user-supplied .js extensions (survive upgrades)
    styles/        ← user-supplied .css overrides (survive upgrades)
    folder.view2-<version>.txz  ← the installed package
```

Consequences you must internalise:

- **Never write user data under `/usr/local/emhttp/`.** It evaporates at reboot.
- Config is on a USB stick. Writes are cheap-ish but not free; don't write in a loop.
- Upgrading replaces the whole RAM-disk tree. `scripts/` and `styles/` on flash are
  the *only* place user customisation can survive an upgrade.
- **Uninstalling wipes the flash directory too** — surviving an upgrade is not the
  same as surviving a removal. Nothing here is backed up automatically.

---

## 3. Repository layout

```
folder.view2.plg          Plugin manifest (XML+DTD). Version, MD5, changelog,
                          install/remove shell. This is what Unraid installs.
pkg_build.sh              Build: src/ → archive/folder.view2-YYYY.MM.DD.txz,
                          then rewrites version+md5 entities in the .plg.
copy_to_git.sh            REVERSE sync: live server → repo. See §5.
archive/*.txz             Committed release artifacts. The .plg downloads these.
orig_folder.js            Reference copy of upstream folder.js. Not shipped.
dev/                      Extension-author docs + event templates + HTML snapshots
                          of the markup the plugin generates.
img/                      README assets.

src/folder.view2/usr/local/emhttp/plugins/folder.view2/
    *.page                Unraid page definitions (front-matter + PHP/HTML)
    server/*.php          9 HTTP endpoints, all thin wrappers over lib.php
    scripts/*.js          Per-tab client logic (docker, vm, dashboard, folder form)
    scripts/include/      Vendored libs: Chart.js, moment, jquery.i18n, multiselect
    styles/*.css          Per-tab styling
    styles|scripts/custom.php  Globs user files off flash and injects <link>/<script>
    langs/*.json          7 locales; langs/script.php bootstraps jquery.i18n
```

The `src/` path mirrors the *installed filesystem layout* exactly, because
`pkg_build.sh` just tars it. What you see under `src/` is what lands on the server.

---

## 4. Tech stack

Deliberately old-fashioned, and it should stay that way.

- **PHP 8** — no framework, no Composer, no autoloader. `require_once` and functions.
- **jQuery + ES6** — no bundler, no transpiler, no `node_modules`, no `package.json`.
  Scripts are served byte-for-byte as they are in the repo.
- **Vendored dependencies** — checked into `scripts/include/`. Updating one means
  dropping in a new minified file.
- **Slackware `.txz`** — the Unraid package format. `tar -cJf`, nothing more.

There is **no build step for application code**. Edit `.js`, refresh browser, done.
`pkg_build.sh` only exists to produce a release tarball.

---

## 5. Development workflow

Two workflows exist in this repo, and only one of them is the good one.

### The historical one — `copy_to_git.sh`

```bash
# Runs ON the Unraid server, from a clone of this repo:
rm -Rf src/.../folder.view2/*
cp /usr/local/emhttp/plugins/folder.view2/* src/.../folder.view2 -R -v -p
```

It copies the **live server** back into the repo. This is how the project has been
maintained: edit files directly on a running Unraid box, then reverse-sync into git.
It works, but it makes the server the source of truth and git the backup, which is
backwards, and it silently destroys any repo-only change (note the `rm -Rf`).

### The one to prefer

Edit in the repo → copy `src/.../folder.view2/*` onto a test server → hard-refresh
the browser. Because there is no build step, a file copy is the whole deploy. Then
commit from the repo, not from the server.

Either way you need **a running Unraid 7 box with Docker enabled**. Nothing here can
be exercised off-server: the code calls `DockerClient.php`, `libvirt_helpers.php`,
`$dockerManPaths`, and Unraid's `dockerload` SSE stream, none of which exist
elsewhere. There is no test suite, no CI, no linter, no mock harness.

### Cutting a release

```bash
./pkg_build.sh        # builds archive/folder.view2-$(date +%Y.%m.%d).txz
                      # and rewrites <!ENTITY version> + <!ENTITY md5> in the .plg
git add archive/ folder.view2.plg && git commit
```

Version numbers are dates. A second build the same day gets `.1`, `.2`, … appended.
Then hand-edit the `<CHANGES>` block in the `.plg` — `pkg_build.sh` does not touch it.

---

## 6. Conventions to follow

**Naming.** PHP helper functions added to `lib.php` are prefixed `fv2_` to avoid
colliding with the Unraid globals the file pulls in. Client-side, the plugin defines
unprefixed globals (`createFolder`, `rmFolder`, `dropDownButton`, …) directly on
`window` — they are referenced from inline `onclick=` attributes in generated HTML,
so they must stay global and must not shadow anything the host page defines.

**Three near-identical implementations.** `docker.js`, `vm.js`, and `dashboard.js`
each contain their own `createFolders` / `createFolder` / `rmFolder` / `actionFolder`.
`dashboard.js` contains *both* a Docker and a VM variant. A behavioural fix usually
has to land in **three or four places**. Grep before you assume you're done.

**Translations.** All user-facing strings go through `$.i18n('key')` with the key
defined in `langs/en.json` — 153 translatable keys, plus an `@metadata` entry. Seven
locales ship (`de es fr it pl zh` + `en`). `langs/script.php` always loads `en.json`
alongside the active locale and `jquery.i18n.fallbacks.js` resolves per-key, so an
untranslated key degrades gracefully rather than rendering blank. This matters in
practice: `pl.json` carries only 91 of the 153 keys. Add to `en.json` at minimum.

**Debug mode.** Type `debug` on the Docker/VM/Dashboard tab and the plugin dumps a
JSON snapshot (folders, both order arrays, container info) to your downloads. This
is the fastest way to diagnose an ordering bug. There is also a compile-time-ish
`FOLDER_VIEW_DEBUG_MODE` const at the top of `docker.js` and `FV2_DEBUG_MODE` in
`lib.php` for verbose logging.

**Custom CSS/JS files** follow `ANYTHING.TAB.css` where TAB is `dashboard`, `docker`,
`vm`, or a `-`-joined combination — the leading dot matters. Documented in
[dev/README.md](dev/README.md).

---

## 7. Sharp edges — verified, not speculative

Things that will bite you. Details and reasoning in
[ARCHITECTURE.md §7](ARCHITECTURE.md#7-honest-assessment).

1. **The `.plg` package URL points at a branch that does not exist.**
   [folder.view2.plg:290](folder.view2.plg#L290) fetches from
   `raw.github.com/VladoPortos/folder.view2/**master**/archive/…` while
   [line 8](folder.view2.plg#L8) uses `**main**` for the plugin URL. It also points
   at the upstream repo, not this fork.

2. **The `.plg` version is stale.** It declares `2025.04.13`
   ([folder.view2.plg:9](folder.view2.plg#L9)) but `archive/` contains builds through
   `2025.05.26`. Installing from the manifest gets you an older package than the repo
   holds.

3. **A real security chain — CSRF → path traversal → stored XSS, running as root.**
   Three separate gaps that compose. Treat this as a genuine finding, not hygiene:

   - **No CSRF token on the mutating endpoints.** `create.php`, `update.php` and
     `delete.php` accept requests without Unraid's `csrf_token`, and `delete.php`
     mutates on a `GET`. Session auth does *not* mitigate this — CSRF is precisely
     the attack where the victim already has a valid session. Any page a logged-in
     admin visits can drive these endpoints.
   - **`type` is unvalidated and lands in a filesystem path.** `$_GET['type']` /
     `$_POST['type']` flows into `"$configDir/$type.json"` throughout
     [lib.php:73-116](src/folder.view2/usr/local/emhttp/plugins/folder.view2/server/lib.php#L73-L116)
     with no whitelist — including `createFile`, which is the *write* primitive
     reachable from the read path. Note `readUserPrefs`
     ([lib.php:81-84](src/folder.view2/usr/local/emhttp/plugins/folder.view2/server/lib.php#L81-L84))
     already whitelists correctly; the pattern exists, it just wasn't applied.
   - **`folder.name` and `folder.icon` are interpolated raw into HTML** at
     [docker.js:263](src/folder.view2/usr/local/emhttp/plugins/folder.view2/scripts/docker.js#L263).
     A folder created via the first two gaps whose name is `<img src=x onerror=…>`
     executes in the admin's session on the next Docker-tab load.

   Fixes are small and independent: `in_array($type, ['docker','vm'], true)`, match
   Unraid's `csrf_token` convention, and escape the two interpolations. Roughly
   25 lines total.

4. **The plugin depends on Unraid internals it does not declare.** Two kinds:

   - *Patched:* `window.loadlist` and `window.listview` are wrapped;
     `$.ajaxPrefilter` intercepts `UserPrefs.php`, `DashboardApps.php`, and
     `VMMachines.php`.
   - *Consumed but never declared:* `eventURL` (the Docker action endpoint — note
     `vm.js` declares its own, `docker.js` does not), the `dockerload` EventSource,
     `switchButton`, `openBox`, `autov`, and the `docker_listview_mode` cookie. Plus
     a hard runtime dependency on the third-party **User Scripts** plugin for custom
     script actions.

   Any of these being renamed breaks the plugin exactly as hard as a `loadlist`
   signature change, but with no patch site to grep for. Re-verify after any Unraid
   update — the changelog is years of exactly that.

5. **Ordering is index arithmetic over a live-mutated array.** `createFolder` returns
   a count of absorbed rows and the caller rewinds its loop counter by it
   ([docker.js:124-126](src/folder.view2/usr/local/emhttp/plugins/folder.view2/scripts/docker.js#L124-L126)).
   It is the single most fragile thing in the codebase and the source of most
   historical "folder appears in the wrong place" bugs. See
   [ARCHITECTURE.md §4.3](ARCHITECTURE.md#43-reconciling-two-orderings) for a known
   unresolved inconsistency feeding it.

6. **`readInfo` shells out per *Tailscale-enabled* container.** Those trigger up to
   two `docker exec` calls each, serially, on *every* list refresh
   ([lib.php:29-71](src/folder.view2/usr/local/emhttp/plugins/folder.view2/server/lib.php#L29-L71)).
   Names are regex-validated *and* `escapeshellarg`'d, so this one is genuinely safe
   — it is purely a latency problem. Containers without Tailscale cost nothing.

7. **~290 of `docker.js`'s 1752 lines are debug logging** guarded by a constant that
   ships as `false`. There is also dead debug code keyed to one specific folder ID
   from the original author's own server
   ([docker.js:206-210](src/folder.view2/usr/local/emhttp/plugins/folder.view2/scripts/docker.js#L206-L210)).
   Read past both.

8. **`pkg_build.sh` runs `chmod 0755 -R .` across the whole repo** — twice, including
   `.git`. Be aware before running it anywhere you care about file modes.

---

## 8. Where to start reading

| Goal | Start here |
|---|---|
| Understand the whole thing | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Change how a folder renders | `scripts/docker.js` → `createFolder`, then the CSS |
| Change the create/edit form | `Folder.page` (markup) + `scripts/folder.js` (behaviour) |
| Change what data the UI gets | `server/lib.php` → `readInfo` |
| Fix an ordering bug | `scripts/docker.js` → `createFolders`, and type `debug` in the UI |
| Add a setting | `Folder.page`, `folder.js:submitForm`, then all three consumers |
| Write a third-party extension | [dev/README.md](dev/README.md) + `dev/docker/events.js` |
