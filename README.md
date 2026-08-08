# FolderView2 For Unraid 7

## What is FolderView2?

Original creator: [**scolcipitato**](https://github.com/scolcipitato/folder.view)

FolderView2 lets you create folders for grouping Dockers and VMs together to help with organization. Especially useful if you're using docker-compose.
Getting Started: A new button named "Add Folder" will appear at the bottom of the docker/VM tab next to "Add Container/VM".

> **The plugin package is now named `unraid-folderview`** (it was `folder.view2`).
> Installing it migrates your folders automatically — see [Upgrading](#upgrading-from-folderview2) below.

## Installation

Manual for now, need to figure out how to submit to Unraid app store.

### Easy Manual installation

Use link: https://raw.githubusercontent.com/FugginOld/unraid-folderview/refs/heads/main/unraid-folderview.plg

That link can be posted directly into the plugin install without needing to copy it to the filesystem beforehand.

[![Install FolderView2](img/plugin_install.png)]


### Manual installation
1. Copy the `unraid-folderview.plg` file to `/boot/config/plugins/` folder.
2. Copy the latest `unraid-folderview-<date>.txz` from the archive folder to `/boot/config/plugins/unraid-folderview/` folder.
3. In Unraid webui go to Plugins -> Install Plugin tab, click on the folder `config` -> `plugins` -> `unraid-folderview.plg` and press install button.

## Upgrading from FolderView2

Installing `unraid-folderview` **copies** your existing folders, custom scripts and
custom styles across automatically. Your originals are left untouched at
`/boot/config/plugins/folder.view2`.

Containers tagged with the old `folder.view2` docker label are still recognised, so
existing `docker-compose.yml` files keep working. New setups should use the
`unraid-folderview` label.

**Check your Docker and VMs tabs before removing the old FolderView2 plugin** —
removing it deletes `/boot/config/plugins/folder.view2`, including your originals.

### Backup (recommended before any upgrade)

Go to Plugins -> FolderView and "Export All" your current settings.

If you can't access the FolderView UI, back these up from the flash drive instead:

```bash
root@PlexServer:/boot/config/plugins/unraid-folderview# ls
docker.json  scripts/  styles/  unraid-folderview-2026.08.07.txz  version  vm.json
```

`docker.json` and `vm.json` hold every folder you have made. `scripts/` and `styles/`
hold your customisations.

If you have not upgraded yet, that same content is under the old plugin's directory
instead:

```bash
root@PlexServer:/boot/config/plugins/folder.view2# ls
docker.json  folder.view2-2025.05.26.txz  scripts/  styles/  version  vm.json
```

## Support & Feedback
If you have any questions or issues, please file an issue on [GitHub](https://github.com/FugginOld/unraid-folderview/issues).

## Contributors
- [TurboStreetCar](https://github.com/TurboStreetCar) - Contributed improved folder.js implementation for compatibility with Unraid 7 and older versions

---

## ☕ Buy Me a Coffee (or a Beer!)

If you like this project and want to support my caffeine-fueled coding sessions, you can buy me a coffee (or a beer, I won't judge! 🍻) on Ko-fi:

[![Support me on Ko-fi](img/support_me_on_kofi_badge_red.png)](https://ko-fi.com/vladoportos)

Every donation helps to proofe to my wife that I'm not a complete idiot :D

---

### Libraries used in this project:
- [Chart.js](https://www.chartjs.org/)
- [chartjs-adapter-moment](https://github.com/chartjs/chartjs-adapter-moment)
- [Moment.js](https://momentjs.com/)
- [chartjs-plugin-streaming](https://github.com/nagix/chartjs-plugin-streaming)
- [jquery.i18n](https://github.com/wikimedia/jquery.i18n)
- [jQuery UI MultiSelect](https://github.com/ehynds/jquery-ui-multiselect-widget)
