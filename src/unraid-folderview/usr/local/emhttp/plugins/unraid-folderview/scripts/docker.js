// The debug switch and folderLog/folderWarn live in scripts/folder-core.js, which every
// tab page loads first. Flip it from the browser console with
//   FOLDER_VIEW_DEBUG_MODE = true
// and the next render logs; no reload needed.
folderLog('docker.js loaded.');

/**
 * Handles the creation of all folders
 */
const createFolders = async () => {
    folderLog('createFolders: Entry');
    const prom = await Promise.all(folderReq);
    folderLog('createFolders: Promises resolved', prom);
    // Parse the results
    let folders = JSON.parse(prom[0]);
    const unraidOrder = JSON.parse(prom[1]);
    const containersInfo = JSON.parse(prom[2]);
    let order = Object.values(JSON.parse(prom[3]));

    // Deep-copied because `order` and `folders` are both mutated further down and the
    // browser console renders live object references, not snapshots.
    folderLog('createFolders: initial orders', JSON.parse(JSON.stringify({
        unraidOrder, order, folders, containersInfo: Object.keys(containersInfo)
    })));


    // Interleave the folder placeholders saved in userprefs.cfg into the live order.
    // See folder-core.js — pure, and covered by tests/folder-core.test.js.
    order = interleaveFolders(unraidOrder, order, folders);
    folderLog('createFolders: Order after inserting Unraid-ordered folders', [...order]);
    const autostartOrder = Object.values(containersInfo).filter(el => !(el.info.State.Autostart===false)).sort((a, b) => {
        if(a.info.State.Autostart < b.info.State.Autostart) {
          return -1;
        }
          if(a.info.State.Autostart > b.info.State.Autostart) {
          return 1;
        }
          return 0;
    }).map(el => el.info.Name);
    folderLog('createFolders: autostartOrder', autostartOrder);
    // debug mode, download the debug json file
    if(folderDebugMode) { // This is the existing folderDebugMode, not FOLDER_VIEW_DEBUG_MODE
        folderLog('createFolders: folderDebugMode (existing) is TRUE. Preparing debug JSON download.');
        let element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(JSON.stringify({
            version: (await $.get('/plugins/unraid-folderview/server/version.php').promise()).trim(),
            folders,
            unraidOrder,
            originalOrder: JSON.parse(await $.get('/plugins/unraid-folderview/server/read_unraid_order.php?type=docker').promise()),
            newOnes: order.filter(x => !unraidOrder.includes(x)),
            order,
            containersInfo
        })));
        element.setAttribute('download', 'debug-DOCKER.json');

        element.style.display = 'none';
        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
        console.log('Order:', [...order]); // Existing log
        folderLog('createFolders: Debug JSON downloaded. Order logged (existing log):', [...order]);
    }

    let foldersDone = {};
    folderLog('createFolders: Initialized foldersDone', foldersDone);
    if(folderobserver) {
        folderLog('createFolders: Disconnecting existing folderobserver.');
        folderobserver.disconnect();
        folderobserver = undefined;
    }

    folderobserver = new MutationObserver((mutationList, observer) => {
        folderLog('folderobserver: Mutation observed', mutationList);
        for (const mutation of mutationList) {
            if(/^load-/.test(mutation.target.id)) {
                folderLog('folderobserver: Target ID matches /^load-/', mutation.target.id, mutation.target.className);
                $('i#folder-' + mutation.target.id).attr('class', mutation.target.className)
            }
        }
    });
    folderLog('createFolders: New folderobserver created.');
    folderLog('createFolders: Dispatching docker-pre-folders-creation event.');
    folderEvents.dispatchEvent(new CustomEvent('docker-pre-folders-creation', {detail: {
        folders: folders,
        order: order,
        containersInfo: containersInfo
    }}));

    // Draw the folders in the order
    folderLog('createFolders: Starting loop to draw folders in order.');
    for (let key = 0; key < order.length; key++) {
        const container = order[key];
        folderLog(`createFolders: Loop iteration: key=${key}, container=${container}`);
        if (container && folderRegex.test(container)) {
            let id = container.replace(folderRegex, '');
            folderLog(`createFolders: Is a folder: id=${id}`);
            if (folders[id]) {
                folderLog(`createFolders: Folder ${id} exists in folders data. Calling createFolder. Position in order: ${key}`);
                // Pass 'order' (the live array) to createFolder.
                // 'position' is the current 'key' (index of the folder placeholder in the 'order' array).
                const removedCount = createFolder(folders[id], id, key, order, containersInfo, Object.keys(foldersDone));
                key -= removedCount; // Adjust key by the number of items that were before the folder and moved into it.
                folderLog(`createFolders: createFolder for ${id} returned remBefore=${removedCount}. Adjusted main loop key to ${key}.`);
                foldersDone[id] = folders[id];
                delete folders[id];
                folderLog(`createFolders: Folder ${id} moved to foldersDone. Updated foldersDone:`, {...foldersDone}, "Remaining folders:", {...folders});
            } else {
                folderWarn(`createFolders: Folder ${id} (from order) not found in folders data.`);
            }
        }
    }
    folderLog('createFolders: Finished loop for ordered folders.');
    // Draw the foldes outside of the order
    folderLog('createFolders: Starting loop to draw folders outside of order (remaining).');
    for (const [id, value] of Object.entries(folders)) {
        folderLog(`createFolders: Processing remaining folder: id=${id}`);
        // Add the folder on top of the array
        order.unshift(`folder-${id}`);
        folderLog(`createFolders: Unshifted folder-${id} to order. New order:`, [...order]);
        createFolder(value, id, 0, order, containersInfo, Object.keys(foldersDone));
        // Move the folder to the done object and delete it from the undone one
        foldersDone[id] = folders[id];
        delete folders[id];
        folderLog(`createFolders: Remaining folder ${id} moved to foldersDone. Updated foldersDone:`, {...foldersDone}, "Remaining folders:", {...folders});
    }
    folderLog('createFolders: Finished loop for remaining folders.');
    // Expand folders that are set to be expanded by default, this is here because is easier to work with all compressed folder when creating them
    folderLog('createFolders: Expanding folders set to expand by default.');
    for (const [id, value] of Object.entries(foldersDone)) {
        if ((globalFolders[id] && globalFolders[id].status.expanded) || value.settings.expand_tab) {
            folderLog(`createFolders: Expanding folder ${id} by default.`);
            value.status.expanded = true;
            dropDownButton(id);
        }
    }

    folderLog('createFolders: Dispatching docker-post-folders-creation event.');
    folderEvents.dispatchEvent(new CustomEvent('docker-post-folders-creation', {detail: {
        folders: folders, // Note: this `folders` object will be empty here if all were processed
        order: order,
        containersInfo: containersInfo
    }}));

    // Assing the folder done to the global object
    globalFolders = foldersDone;
    folderLog('createFolders: Assigned foldersDone to globalFolders:', {...globalFolders});
    folderDebugMode = false; // Existing flag
    folderLog('createFolders: Set folderDebugMode (existing) to false.');
    const autostartActual = $('.ct-name .appname').map(function() {return $(this).text()}).get().filter(x => autostartOrder.includes(x));
    folderLog('createFolders: autostartActual (from DOM)', autostartActual);
    if(!(autostartOrder.length === autostartActual.length && autostartOrder.every((value, index) => value === autostartActual[index]))) {
        folderWarn('createFolders: Autostart order is incorrect. Updating UI elements.');
        $('.nav-item.AutostartOrder.util > a > b').removeClass('green-text').addClass('red-text');
        $('.nav-item.AutostartOrder.util > a > span').text($.i18n('incorrect-autostart'));
        $('.nav-item.AutostartOrder.util > a').attr('title', $.i18n('incorrect-autostart'));
    } else {
        folderLog('createFolders: Autostart order is correct.');
    }
    folderLog('createFolders: Exit');
};

/**
 * Handles the creation of one folder
 * @param {object} folder the folder
 * @param {string} id if of the folder
 * @param {int} position position to inset the folder
 * @param {Array<string>} order order of containers
 * @param {object} containersInfo info of the containers
 * @param {Array<string>} foldersDone folders that are done
 * @returns {number} the number of element removed before the folder
 */
const createFolder = (folder, id, positionInMainOrder, liveOrderArray, containersInfo, foldersDone) => {
    folderLog(`createFolder (id: ${id}): Entry`, { folder: JSON.parse(JSON.stringify(folder)), id, positionInMainOrder, orderInitialSnapshot: [...liveOrderArray], containersInfoKeys: Object.keys(containersInfo).length, foldersDone: [...foldersDone] });
    // --- Store a snapshot of the live order array AT THE START of this folder's processing ---
    // This snapshot is crucial for correctly calculating `remBefore` based on original positions.
    const orderSnapshotAtFolderStart = [...liveOrderArray];
    folderLog(`createFolder (id: ${id}): Dispatching docker-pre-folder-creation event.`);
    folderEvents.dispatchEvent(new CustomEvent('docker-pre-folder-creation', {detail: {
        folder: folder, // Be aware: if 'folder' object is modified by listeners, it affects this function
        id: id,
        position: positionInMainOrder, // Use the more descriptive name
        order: liveOrderArray,         // Pass the live array
        containersInfo: containersInfo,
        foldersDone: foldersDone
    }}));

    // Default variables
    let upToDate = true;
    let started = 0;
    let autostart = 0;
    let autostartStarted = 0;
    let managed = 0;
    let remBefore = 0; // This will count items *from this folder* that were originally before its placeholder
    folderLog(`createFolder (id: ${id}): Initialized local state variables`, { upToDate, started, autostart, autostartStarted, managed, remBefore });
    const advanced = $.cookie('docker_listview_mode') == 'advanced';
    folderLog(`createFolder (id: ${id}): Advanced view enabled: ${advanced}`);
    // --- Correctly build combinedContainers ---
    const originalContainersFromDefinition = Array.isArray(folder.containers) ? [...folder.containers] : [];
    let combinedContainers = [...originalContainersFromDefinition];
    folderLog(`createFolder (id: ${id}): Initial containers from definition for combinedContainers:`, [...originalContainersFromDefinition]);
    if (folder.regex && typeof folder.regex === 'string' && folder.regex.trim() !== "") {
        folderLog(`createFolder (id: ${id}): Regex defined: '${folder.regex}'. Filtering orderSnapshotAtFolderStart.`);
        try {
            const re = new RegExp(folder.regex);
            const regexMatches = orderSnapshotAtFolderStart.filter(el => containersInfo[el] && re.test(el) && !combinedContainers.includes(el));
            regexMatches.forEach(match => combinedContainers.push(match));
            folderLog(`createFolder (id: ${id}): Regex matches added:`, regexMatches, "Combined containers after regex:", [...combinedContainers]);
        } catch (e) {
            folderWarn(`createFolder (id: ${id}): Invalid regex '${folder.regex}':`, e);
        }
    } else {
        if (folder.regex) folderLog(`createFolder (id: ${id}): Regex is present but empty or invalid, skipping regex matching.`);
    }

    // Accept the legacy 'folder.view2' label as well as the current one -- existing
    // docker-compose files in the wild still carry it, and silently unfiling those
    // containers on upgrade would look like data loss.
    const labelMatches = orderSnapshotAtFolderStart.filter(el => {
        const labels = containersInfo[el]?.Labels;
        const folderLabel = labels?.['unraid-folderview'] ?? labels?.['folder.view2'];
        return folderLabel === folder.name && !combinedContainers.includes(el);
    });
    labelMatches.forEach(match => combinedContainers.push(match));

    folderLog(`createFolder (id: ${id}): Containers matched by 'unraid-folderview' label ('${folder.name}'):`, labelMatches);
    folderLog(`createFolder (id: ${id}): Final combined list of containers for folder processing (combinedContainers):`, [...combinedContainers]);
    // --- End of combinedContainers build ---

    const colspan = document.querySelector("#docker_containers > thead > tr").childElementCount - 5;
    const fld = `<tr class="sortable folder-id-${id} ${folder.settings.preview_hover ? 'hover' : ''} folder"><td class="ct-name folder-name"><div class="folder-name-sub"><i class="fa fa-arrows-v mover orange-text"></i><span class="outer folder-outer"><span id="${id}" onclick="addDockerFolderContext('${id}')" class="hand folder-hand"><img src="${htmlEscape(folder.icon)}" class="img folder-img" onerror='this.src="/plugins/dynamix.docker.manager/images/question.png"'></span><span class="inner folder-inner"><span class="appname" style="display: none;"><a>folder-${id}</a></span><a class="exec folder-appname" onclick='editFolder("${id}")'>${htmlEscape(folder.name)}</a><br><i id="load-folder-${id}" class="fa fa-square stopped red-text folder-load-status"></i><span class="state folder-state"> ${$.i18n('stopped')}</span></span></span><button class="dropDown-${id} folder-dropdown" onclick="dropDownButton('${id}')" ><i class="fa fa-chevron-down" aria-hidden="true"></i></button></div></td><td class="updatecolumn folder-update"><span class="green-text folder-update-text"><i class="fa fa-check fa-fw"></i> ${$.i18n('up-to-date')}</span><div class="advanced" style="display: ${advanced ? 'block' : 'none'};"><a class="exec" onclick="forceUpdateFolder('${id}');"><span style="white-space:nowrap;"><i class="fa fa-cloud-download fa-fw"></i> ${$.i18n('force-update')}</span></a></div></td><td colspan="${colspan}"><div class="folder-storage"></div><div class="folder-preview"></div></td><td class="advanced folder-advanced" ${advanced ? 'style="display: table-cell;"' : ''}><span class="cpu-folder-${id} folder-cpu">0%</span><div class="usage-disk mm folder-load"><span id="cpu-folder-${id}" class="folder-cpu-bar" style="width:0%"></span><span></span></div><br><span class="mem-folder-${id} folder-mem">0 / 0</span></td><td class="folder-autostart"><input type="checkbox" id="folder-${id}-auto" class="autostart" style="display:none"><div style="clear:left"></div></td><td></td></tr>`;
    folderLog(`createFolder (id: ${id}): colspan=${colspan}. Generated folder HTML (fld).`);
    if (positionInMainOrder === 0) {
        folderLog(`createFolder (id: ${id}): Inserting folder HTML at position 0 (before).`);
        $('#docker_list > tr.sortable').eq(0).before($(fld)); // Always eq(0) for 'before' the first sortable
    } else {
        // Find the actual DOM element that is currently at positionInMainOrder - 1 in the *visible sortable list*
        // This needs to be robust to items already having been moved.
        // A safer bet is to find the *last processed item* or *first non-folder item* if the folder is inserted later.
        // For now, using the direct index, assuming other sortables are still in place.
        if ($('#docker_list > tr.sortable').length > 0 && positionInMainOrder > 0) {
             folderLog(`createFolder (id: ${id}): Inserting folder HTML at position ${positionInMainOrder} (after eq ${positionInMainOrder-1} of current sortables).`);
             $('#docker_list > tr.sortable').eq(positionInMainOrder - 1).after($(fld));
        } else if ($('#docker_list > tr.sortable').length === 0 && positionInMainOrder === 0) {
            // If no sortables exist yet (e.g., first folder, all others are new)
             folderLog(`createFolder (id: ${id}): No sortables found, inserting folder at the beginning of #docker_list.`);
            $('#docker_list').prepend($(fld));
        } else {
             folderWarn(`createFolder (id: ${id}): Could not determine insertion point for folder. Position: ${positionInMainOrder}, Sortables count: ${$('#docker_list > tr.sortable').length}`);
             // Fallback: append to the list if other logic fails
             $('#docker_list').append($(fld));
        }
    }

    $(`#folder-${id}-auto`).switchButton({ labels_placement: 'right', off_label: $.i18n('off'), on_label: $.i18n('on'), checked: false });
    folderLog(`createFolder (id: ${id}): Initialized autostart switchButton.`);
    if(folder.settings.preview_border) {
        folderLog(`createFolder (id: ${id}): Setting preview border color to ${folder.settings.preview_border_color}.`);
        $(`tr.folder-id-${id}  div.folder-preview`).css('border', `solid ${folder.settings.preview_border_color} 1px`);
    }
    $(`tr.folder-id-${id} div.folder-preview`).addClass(`folder-preview-${folder.settings.preview}`);
    folderLog(`createFolder (id: ${id}): Added class folder-preview-${folder.settings.preview} to preview div.`);
    let addPreview;
    folderLog(`createFolder (id: ${id}): Selecting addPreview function based on folder.settings.preview = ${folder.settings.preview}. Context setting: ${folder.settings.context}`);
    switch (folder.settings.preview) {
        case 1:
            addPreview = (folderTrId, ctid, autostart) => {
                folderLog(`addPreview (case 1 for ${folderTrId}): ctid=${ctid}, autostart=${autostart}`);
                let clone = $(`tr.folder-id-${folderTrId} div.folder-storage > tr > td.ct-name > span.outer:last`).clone();
                clone.find(`span.state`)[0].innerHTML = clone.find(`span.state`)[0].innerHTML.split("<br>")[0];
                $(`tr.folder-id-${folderTrId} div.folder-preview`).append(clone.addClass(`${autostart ? 'autostart' : ''}`));
                let tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview > span.outer:last`).find('i[id^="load-"]');
                tmpId.attr("id", "folder-" + tmpId.attr("id"));
                if(folder.settings.context === 2 || folder.settings.context === 0) {
                    tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview > span.outer:last > span.hand`);
                    tmpId.attr("id", "folder-preview-" + ctid);
                    tmpId.removeAttr("onclick");
                    folderLog(`addPreview (case 1 for ${folderTrId}): Context is ${folder.settings.context}. Modified preview element for tooltipster:`, tmpId);
                    if(folder.settings.context === 2) { return tmpId; }
                }
            }; break;
        case 2:
            addPreview = (folderTrId, ctid, autostart) => {
                folderLog(`addPreview (case 2 for ${folderTrId}): ctid=${ctid}, autostart=${autostart}`);
                $(`tr.folder-id-${folderTrId} div.folder-preview`).append($(`tr.folder-id-${folderTrId} div.folder-storage > tr > td.ct-name > span.outer > span.hand:last`).clone().addClass(`${autostart ? 'autostart' : ''}`));
                if(folder.settings.context === 2 || folder.settings.context === 0) {
                    let tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview > span.hand:last`);
                    tmpId.attr("id", "folder-preview-" + ctid);
                    tmpId.removeAttr("onclick");
                    folderLog(`addPreview (case 2 for ${folderTrId}): Context is ${folder.settings.context}. Modified preview element for tooltipster:`, tmpId);
                    if(folder.settings.context === 2) { return tmpId; }
                }
            }; break;
        case 3:
            addPreview = (folderTrId, ctid, autostart) => {
                folderLog(`addPreview (case 3 for ${folderTrId}): ctid=${ctid}, autostart=${autostart}`);
                let clone = $(`tr.folder-id-${folderTrId} div.folder-storage > tr > td.ct-name > span.outer > span.inner:last`).clone();
                clone.find(`span.state`)[0].innerHTML = clone.find(`span.state`)[0].innerHTML.split("<br>")[0];
                $(`tr.folder-id-${folderTrId} div.folder-preview`).append(clone.addClass(`${autostart ? 'autostart' : ''}`));
                let tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview > span.inner:last`).find('i[id^="load-"]');
                tmpId.attr("id", "folder-" + tmpId.attr("id"));
                if(folder.settings.context === 2 || folder.settings.context === 0) {
                    tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview > span.inner:last > span.appname > a.exec`);
                    tmpId.attr("id", "folder-preview-" + ctid);
                    tmpId.removeAttr("onclick");
                    folderLog(`addPreview (case 3 for ${folderTrId}): Context is ${folder.settings.context}. Modified preview element for tooltipster:`, tmpId);
                    if(folder.settings.context === 2) { return tmpId; }
                }
            }; break;
        case 4:
            addPreview = (folderTrId, ctid, autostart) => {
                folderLog(`addPreview (case 4 for ${folderTrId}): ctid=${ctid}, autostart=${autostart}`);
                let lstSpan = $(`tr.folder-id-${folderTrId} div.folder-preview > span.outer:last`);
                if(!lstSpan[0] || lstSpan.children().length >= 2) {
                    $(`tr.folder-id-${folderTrId} div.folder-preview`).append($('<span class="outer"></span>'));
                    lstSpan = $(`tr.folder-id-${folderTrId} div.folder-preview > span.outer:last`);
                }
                lstSpan.append($('<span class="inner"></span>'));
                lstSpan.children('span.inner:last').append($(`tr.folder-id-${folderTrId} div.folder-storage > tr > td.ct-name > span.outer > span.inner > span.appname:last`).clone().addClass(`${autostart ? 'autostart' : ''}`));
                if(folder.settings.context === 2 || folder.settings.context === 0) {
                    let tmpId = $(`tr.folder-id-${folderTrId} div.folder-preview span.inner:last > span.appname > a.exec`);
                    tmpId.attr("id", "folder-preview-" + ctid);
                    tmpId.removeAttr("onclick");
                    folderLog(`addPreview (case 4 for ${folderTrId}): Context is ${folder.settings.context}. Modified preview element for tooltipster:`, tmpId);
                    if(folder.settings.context === 2) {
                        return tmpId.length>0 ? tmpId : $(`tr.folder-id-${folderTrId} div.folder-preview span.inner:last > span.appname`).attr("id", "folder-preview-" + ctid);
                    }
                }
            }; break;
        default:
            folderLog(`createFolder (id: ${id}): Default case for addPreview (no preview).`);
            addPreview = () => { };
            break;
    }

    let newFolder = {};
    folderLog(`createFolder (id: ${id}): Initialized newFolder for processed containers.`);
    // Note: `cutomOrder` is not used in the critical logic below, but kept for potential other uses or debugging.
    const mappedFoldersDone = foldersDone.map(e => 'folder-'+e);
    const cutomOrder = orderSnapshotAtFolderStart.filter((e) => { // Based on snapshot, as original code
        return e && (mappedFoldersDone.includes(e) || !(folderRegex.test(e) && e !== `folder-${id}`));
    });
    folderLog(`createFolder (id: ${id}): (Informational) Filtered cutomOrder based on orderSnapshotAtFolderStart:`, [...cutomOrder]);
    folderLog(`createFolder (id: ${id}): Starting loop to process ${combinedContainers.length} combinedContainers.`);
    for (const container_name_in_folder of combinedContainers) {

        const ct = containersInfo[container_name_in_folder];
        if (!ct) {
            folderWarn(`createFolder (id: ${id}): CRITICAL - Container info for '${container_name_in_folder}' not found in containersInfo! Skipping further processing for this container.`);
            continue; // Skip this container if info is missing
        }
        const indexInCustomOrder = cutomOrder.indexOf(container_name_in_folder);
        const indexInLiveOrderArray = liveOrderArray.indexOf(container_name_in_folder);

        folderLog(`createFolder (id: ${id}): Processing container from combinedContainers: ${container_name_in_folder}`);
        const originalIndexOfContainerInSnapshot = orderSnapshotAtFolderStart.indexOf(container_name_in_folder);
        folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: originalIndexOfContainerInSnapshot=${originalIndexOfContainerInSnapshot}, folder's positionInMainOrder=${positionInMainOrder}`);
        if (originalIndexOfContainerInSnapshot !== -1 && originalIndexOfContainerInSnapshot < positionInMainOrder) {
            remBefore++;
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Original index ${originalIndexOfContainerInSnapshot} < folder position ${positionInMainOrder}. Incremented remBefore to ${remBefore}.`);
        }

        let $containerTR = $(`#ct-${container_name_in_folder}`);
        if (!$containerTR.length || !$containerTR.hasClass('sortable')) {
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: TR not found by ID or not sortable. Fallback search...`);
            $containerTR = $("#docker_list > tr.sortable").filter(function() {
                return $(this).find("td.ct-name .appname a").text().trim() === container_name_in_folder;
            }).first();
        }

        if ($containerTR.length) {
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Found its TR element in the main list.`);
            folderEvents.dispatchEvent(new CustomEvent('docker-pre-folder-preview', {detail: {
                folder: folder,
                id: id,
                position: positionInMainOrder,
                order: liveOrderArray,
                containersInfo: containersInfo,
                foldersDone: foldersDone, // Original foldersDone
                container: container_name_in_folder,
                ct: ct,
                index: indexInCustomOrder,
                offsetIndex: indexInLiveOrderArray
            }}));

            $(`tr.folder-id-${id} div.folder-storage`).append(
                $containerTR.addClass(`folder-${id}-element folder-element`).removeClass('sortable ui-sortable-handle')
            );
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Moved TR to folder storage.`);
            const currentIndexInLiveList = liveOrderArray.indexOf(container_name_in_folder);
            if (currentIndexInLiveList !== -1) {
                liveOrderArray.splice(currentIndexInLiveList, 1);
                folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Spliced from liveOrderArray. New liveOrderArray length: ${liveOrderArray.length}`);
            } else {
                folderWarn(`createFolder (id: ${id}): Container ${container_name_in_folder} was MOVED FROM DOM but NOT FOUND IN liveOrderArray for splicing. This might indicate it was already spliced by a previous folder or logic error.`);
            }

            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Container info (ct):`, JSON.parse(JSON.stringify(ct)));
            let CPU = []; let MEM = []; let charts = []; let tootltipObserver;
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Initialized CPU, MEM, charts, tootltipObserver for tooltip.`);
            const graphListener = (e) => {
                folderLog(`graphListener (for ct: ${ct.shortId}): Received message:`, e.data ? e.data : e); // SSE e.data
                let now = Date.now();
                try {
                    let dataToParse = e.data ? e.data : e; // Handle SSE vs direct string
                    let loadMatch = dataToParse.match(new RegExp(`^${ct.shortId}\;.*\;.*\ \/\ .*$`, 'm'));
                    if (!loadMatch) {
                        folderWarn(`graphListener (for ct: ${ct.shortId}): No match for regex. Data: `, dataToParse);
                        CPU.push({ x: now, y: 0 });
                        MEM.push({ x: now, y: 0 });
                        return;
                    }
                    let load = loadMatch[0].split(';');
                    load = {
                        cpu: parseFloat(load[1].replace('%', ''))/cpus,
                        mem: load[2].split(' / ')
                    }
                    load.mem = memToB(load.mem[0]) / memToB(load.mem[1]) * 100;
                    CPU.push({
                        x: now,
                        y: load.cpu
                    });
                    MEM.push({
                        x: now,
                        y: load.mem
                    });
                    folderLog(`graphListener (for ct: ${ct.shortId}): Parsed load:`, {cpu: load.cpu, mem: load.mem}, "Pushed to CPU/MEM arrays.");
                } catch (error) {
                    folderWarn(`graphListener (for ct: ${ct.shortId}): Error parsing load data.`, error, "Original data:", e.data ? e.data : e);
                    CPU.push({
                        x: now,
                        y: 0
                    });
                    MEM.push({
                        x: now,
                        y: 0
                    });
                }

                for (const chart of charts) {
                    chart.update('quiet');
                }
                 if (charts.length > 0) folderLog(`graphListener (for ct: ${ct.shortId}): Updated ${charts.length} charts.`);
            };

            const tooltip_trigger_element = addPreview(id, ct.shortId, !(ct.info.State.Autostart === false));
            folderLog(`createFolder (id: ${id}), container ${ct.shortId}: Called addPreview. Returned tooltip_trigger_element:`, tooltip_trigger_element ? tooltip_trigger_element[0] : 'null/undefined');
            $(`tr.folder-id-${id} div.folder-preview span.inner > span.appname`).css("width", folder.settings.preview_text_width || '');
            if (folder.settings.preview_text_width) folderLog(`createFolder (id: ${id}): Set preview text width to ${folder.settings.preview_text_width}.`);
            if(tooltip_trigger_element && tooltip_trigger_element.length > 0) {
                folderLog(`createFolder (id: ${id}), container ${ct.shortId}: tooltip_trigger_element is valid. Initializing tooltipster.`);
                $(tooltip_trigger_element).tooltipster({
                    interactive: true,
                    theme: ['tooltipster-docker-folder'],
                    trigger: (folder.settings.context_trigger===1 ? 'hover' : 'click') || 'click',
                    zIndex: 99998,
                    // --- START OF MODIFIED functionBefore ---
                    functionBefore: function(instance, helper) {
                        // instance: The Tooltipster instance.
                        // helper: An object, helper.origin is the triggering element.
                        const origin = helper.origin; // Get the triggering element

                        folderLog(`Tooltipster (ct: ${ct.shortId}): functionBefore. Instance:`, instance, "Helper:", helper, "Origin:", origin);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Current folder settings for context:`, {...folder.settings});

                        // Dispatch your custom event
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Dispatching docker-tooltip-before event.`);
                        folderEvents.dispatchEvent(new CustomEvent('docker-tooltip-before', {detail: {
                            folder: folder,
                            id: id, // Folder ID
                            containerInfo: ct, // Container info
                            origin: origin,
                            charts: charts, 
                            stats: {
                                CPU: CPU, 
                                MEM: MEM
                            }
                        }}));

                        folderLog(`Tooltipster (ct: ${ct.shortId}): functionBefore completed. Allowing tooltip to proceed by default.`);
                        // By not returning false, Tooltipster should proceed.
                    },
                    functionReady: function(instance, helper) {
                        // instance: The Tooltipster instance
                        // helper: An object with helper.origin (trigger element) and helper.tooltip (tooltip DOM element)

                        const triggerOriginEl = helper.origin;  // This is the jQuery object of the element that triggered the tooltip
                        const tooltipDomEl = helper.tooltip;  // This is the jQuery object of the tooltip's outermost DOM element

                        folderLog(`Tooltipster (ct: ${ct.shortId}): functionReady. Instance:`, instance, "Helper:", helper, "Trigger Origin Element:", triggerOriginEl[0], "Tooltip DOM Element:", tooltipDomEl[0]);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Dispatching docker-tooltip-ready-start event.`);
                        folderEvents.dispatchEvent(new CustomEvent('docker-tooltip-ready-start', {detail: {
                            folder: folder,
                            id: id,
                            containerInfo: ct,
                            origin: triggerOriginEl,
                            tooltip: tooltipDomEl,
                            charts,
                            stats: {
                                CPU,
                                MEM
                            }
                        }}));
                        
                        let diabled = [];
                        let active = 0;
                        const options = {
                            scales: {
                                x: {
                                    type: 'realtime',
                                    realtime: {
                                        duration: 1000*(folder.settings.context_graph_time || 60),
                                        refresh: 1000, 
                                        delay: 1000 
                                    },
                                    time: {
                                        tooltipFormat: 'dd MMM, yyyy, HH:mm:ss',
                                        displayFormats: {
                                            millisecond: 'H:mm:ss.SSS',
                                            second: 'H:mm:ss',
                                            minute: 'H:mm',
                                            hour: 'H',
                                            day: 'MMM D',
                                            week: 'll',
                                            month: 'MMM YYYY',
                                            quarter: '[Q]Q - YYYY',
                                            year: 'YYYY'
                                        },
                                    },
                                },
                                y: {
                                    min: 0,
                                }
                            },
                            interaction: {
                                intersect: false,
                                mode: 'index',
                            },
                            plugins: {
                                tooltip: {
                                    position: 'nearest'
                                }
                            }
                        };
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Chart.js options:`, options, "Graph mode setting:", folder.settings.context_graph);
                        charts = []; 
                        switch (folder.settings.context_graph) {
                            case 0: 
                                folderLog(`Tooltipster (ct: ${ct.shortId}): Graph mode 0 (None).`);
                                diabled = [0, 1, 2]; 
                                active = 3; 
                                break;
                            case 2: 
                                folderLog(`Tooltipster (ct: ${ct.shortId}): Graph mode 2 (Split). Creating CPU and MEM charts.`);
                                diabled = [0]; 
                                active = 1; 
                                try {
                                    charts.push(new Chart($(`.cpu-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), { 
                                        type: 'line',
                                        data: { datasets: [ { label: 'CPU', data: CPU, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), tension: 0.4, pointRadius: 0, borderWidth: 1 } ] },
                                        options: options
                                    }));
                                    charts.push(new Chart($(`.mem-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), { 
                                        type: 'line',
                                        data: { datasets: [ { label: 'MEM', data: MEM, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), tension: 0.4, pointRadius: 0, borderWidth: 1 } ] },
                                        options: options
                                    }));
                                     folderLog(`Tooltipster (ct: ${ct.shortId}): Split charts created. CPU canvas:`, $(`.cpu-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), "MEM canvas:", $(`.mem-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0));
                                } catch(e) {
                                    folderWarn(`Tooltipster (ct: ${ct.shortId}): Error creating split charts:`, e);
                                }
                                break;
                            case 3: 
                                 folderLog(`Tooltipster (ct: ${ct.shortId}): Graph mode 3 (CPU only). Creating CPU chart.`);
                                diabled = [0, 2]; 
                                active = 1; 
                                try {
                                    charts.push(new Chart($(`.cpu-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), { 
                                        type: 'line',
                                        data: { datasets: [ { label: 'CPU', data: CPU, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), tension: 0.4, pointRadius: 0, borderWidth: 1 } ] },
                                        options: options
                                    }));
                                     folderLog(`Tooltipster (ct: ${ct.shortId}): CPU chart created. Canvas:`, $(`.cpu-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0));
                                } catch(e) {
                                     folderWarn(`Tooltipster (ct: ${ct.shortId}): Error creating CPU chart:`, e);
                                }
                                break;
                            case 4: 
                                folderLog(`Tooltipster (ct: ${ct.shortId}): Graph mode 4 (MEM only). Creating MEM chart.`);
                                diabled = [0, 1]; 
                                active = 2; 
                                try {
                                    charts.push(new Chart($(`.mem-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), { 
                                        type: 'line',
                                        data: { datasets: [ { label: 'MEM', data: MEM, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), tension: 0.4, pointRadius: 0, borderWidth: 1 } ] },
                                        options: options
                                    }));
                                    folderLog(`Tooltipster (ct: ${ct.shortId}): MEM chart created. Canvas:`, $(`.mem-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0));
                                } catch(e) {
                                    folderWarn(`Tooltipster (ct: ${ct.shortId}): Error creating MEM chart:`, e);
                                }
                                break;
                            case 1: 
                            default:
                                folderLog(`Tooltipster (ct: ${ct.shortId}): Graph mode 1 (Combined) or default. Creating combined chart.`);
                                diabled = [1, 2]; 
                                active = 0; 
                                try {
                                    charts.push(new Chart($(`.comb-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0), { 
                                        type: 'line',
                                        data: {
                                            datasets: [
                                                { label: 'CPU', data: CPU, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-cpu'), tension: 0.4, pointRadius: 0, borderWidth: 1 },
                                                { label: 'MEM', data: MEM, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--folder-view2-graph-mem'), tension: 0.4, pointRadius: 0, borderWidth: 1 }
                                            ]
                                        },
                                        options: options
                                    }));
                                    folderLog(`Tooltipster (ct: ${ct.shortId}): Combined chart created. Canvas:`, $(`.comb-grapth-${ct.shortId} > canvas`, tooltipDomEl).get(0));
                                } catch(e) {
                                     folderWarn(`Tooltipster (ct: ${ct.shortId}): Error creating combined chart:`, e);
                                }
                                break;
                        };
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Tab states: disabled=${diabled}, active=${active}. Charts array length: ${charts.length}`);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Canvas check inside functionReady:`, {
                            comb: $(`.comb-grapth-${ct.shortId} > canvas`, tooltipDomEl).length,
                            cpu:  $(`.cpu-grapth-${ct.shortId} > canvas`, tooltipDomEl).length,
                            mem:  $(`.mem-grapth-${ct.shortId} > canvas`, tooltipDomEl).length
                        });

                        tootltipObserver = new MutationObserver((mutationList, observer) => {
                            folderLog(`tootltipObserver (for ct: ${ct.shortId}): Mutation observed for CPU text.`, mutationList);
                            for (const mutation of mutationList) {
                                $(`.preview-outbox-${ct.shortId} span#cpu-${ct.shortId}`, tooltipDomEl).css('width',  mutation.target.textContent) 
                            }
                        });

                        const cpuTextElement = $(`.preview-outbox-${ct.shortId} span.cpu-${ct.shortId}`, tooltipDomEl).get(0); 
                        if (cpuTextElement) {
                            tootltipObserver.observe(cpuTextElement, {childList: true});
                            folderLog(`Tooltipster (ct: ${ct.shortId}): tootltipObserver observing CPU text element.`, cpuTextElement);
                        } else {
                            folderWarn(`Tooltipster (ct: ${ct.shortId}): CPU text element for tootltipObserver not found.`);
                        }

                        if($(`.preview-outbox-${ct.shortId} .status-autostart`, tooltipDomEl).children().length === 1) { 
                            folderLog(`Tooltipster (ct: ${ct.shortId}): Initializing switchButton and tabs for tooltip content.`);
                            $(`.preview-outbox-${ct.shortId} .status-autostart > input[type='checkbox']`, tooltipDomEl).switchButton({ labels_placement: 'right', off_label: $.i18n('off'), on_label: $.i18n('on'), checked: !(ct.info.State.Autostart === false) }); 
                            $(`.preview-outbox-${ct.shortId} .info-section`, tooltipDomEl).tabs({ 
                                heightStyle: 'auto',
                                disabled: diabled,
                                active: active
                            });
                            $(`.preview-outbox-${ct.shortId} table > tbody div.status-autostart > input[type="checkbox"]`, tooltipDomEl).on("change", advancedAutostart); 
                        } else {
                             folderWarn(`Tooltipster (ct: ${ct.shortId}): Autostart switch placeholder not found as expected in tooltip.`);
                        }

                        dockerload.addEventListener('message', graphListener);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Added graphListener to dockerload SSE.`);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Dispatching docker-tooltip-ready-end event.`);
                        folderEvents.dispatchEvent(new CustomEvent('docker-tooltip-ready-end', {detail: {
                            folder: folder,
                            id: id,
                            containerInfo: ct,
                            origin: triggerOriginEl,
                            tooltip: tooltipDomEl,
                            charts,
                            tootltipObserver,
                            stats: {
                                CPU,
                                MEM
                            }
                        }}));
                    },
                    functionAfter: function(instance, helper) {
                        const origin = helper.origin;
                        folderLog(`Tooltipster (ct: ${ct.shortId}): functionAfter. Instance:`, instance, "Helper:", helper, "Origin:", origin);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Dispatching docker-tooltip-after event.`);
                        folderEvents.dispatchEvent(new CustomEvent('docker-tooltip-after', {detail: {
                            folder: folder,
                            id: id,
                            containerInfo: ct,
                            origin: origin,
                            charts, 
                            tootltipObserver,
                            stats: { 
                                CPU,
                                MEM
                            }
                        }}));
                        dockerload.removeEventListener('message', graphListener);
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Removed graphListener from dockerload SSE.`);
                        for (const chart of charts) {
                            chart.destroy();
                        }
                        folderLog(`Tooltipster (ct: ${ct.shortId}): Destroyed ${charts.length} charts.`);
                        charts = []; 
                        if (tootltipObserver) {
                            tootltipObserver.disconnect();
                            tootltipObserver = undefined;
                            folderLog(`Tooltipster (ct: ${ct.shortId}): Disconnected and cleared tootltipObserver.`);
                        }
                    },
                   content: $(`
                        <div class="preview-outbox preview-outbox-${ct.shortId}">
                            <div class="first-row">
                                <div class="preview-name">
                                    <div class="preview-img"><img src="${htmlEscape(ct.Labels['net.unraid.docker.icon'] || '')}" class="img folder-img" onerror='this.src="/plugins/dynamix.docker.manager/images/question.png"'></div>
                                    <div class="preview-actual-name">
                                        <span class="blue-text appname">${htmlEscape(ct.info.Name)}</span><br>
                                        <i class="fa fa-${ct.info.State.Running ? (ct.info.State.Paused ? 'pause' : 'play') : 'square'} ${ct.info.State.Running ? (ct.info.State.Paused ? 'paused' : 'started') : 'stopped'} ${ct.info.State.Running ? (ct.info.State.Paused ? 'orange-text' : 'green-text') : 'red-text'}"></i>
                                        <span class="state"> ${ct.info.State.Running ? (ct.info.State.Paused ? $.i18n('paused') : $.i18n('started')) : $.i18n('stopped')}</span>
                                    </div>
                                </div>
                                <table class="preview-status">
                                    <thead class="status-header"><tr><th class="status-header-version">${$.i18n('version')}</th><th class="status-header-stats">CPU/MEM</th><th class="status-header-autostart">${$.i18n('autostart')}</th></tr></thead>
                                    <tbody><tr>
                                        <td><div class="status-version">${!ct.info.State.Updated === false ? `<span class="green-text folder-update-text"><i class="fa fa-check fa-fw"></i>${$.i18n('up-to-date')}</span>${ct.info.State.manager === 'dockerman' ? `<br><a class="exec" onclick="hideAllTips(); updateContainer('${ct.info.Name}');"><span style="white-space:nowrap;"><i class="fa fa-cloud-download fa-fw"></i>${$.i18n('force-update')}</span></a>` : ''}`:`<span class="orange-text folder-update-text" style="white-space:nowrap;"><i class="fa fa-flash fa-fw"></i>${$.i18n('update-ready')}</span><br><a class="exec" onclick="hideAllTips(); updateContainer('${ct.info.Name}');"><span style="white-space:nowrap;"><i class="fa fa-cloud-download fa-fw"></i>${$.i18n('apply-update')}</span></a>`}<br><i class="fa fa-info-circle fa-fw"></i> ${ct.info.Config.Image.split(':').pop()}</div></td>
                                        <td><div class="status-stats"><span class="cpu-${ct.shortId}">0%</span><div class="usage-disk mm"><span id="cpu-${ct.shortId}" style="width: 0%;"></span><span></span></div><br><span class="mem-${ct.shortId}">0 / 0</span></div></td>
                                        <td><div class="status-autostart"><input type="checkbox" style="display:none" class="staus-autostart-checkbox"></div></td>
                                    </tr></tbody>
                                </table>
                            </div>
                            <div class="second-row">
                                <div class="action-info">
                                    <div class="action">
                                        <div class="action-left">
                                            <ul class="fa-ul">
                                                ${(ct.info.State.Running && !ct.info.State.Paused) ? 
                                                    `${ct.info.State.WebUi ? `<li><a href="${htmlEscape(ct.info.State.WebUi)}" target="_blank"><i class="fa fa-globe" aria-hidden="true"></i> ${$.i18n('webui')}</a></li>` : ''}
                                                     ${ct.info.State.TSWebUi ? `<li><a href="${htmlEscape(ct.info.State.TSWebUi)}" target="_blank"><i class="fa fa-shield" aria-hidden="true"></i> ${$.i18n('tailscale-webui')}</a></li>` : ''}
                                                     <li><a onclick="event.preventDefault(); openTerminal('docker', '${ct.info.Name}', '${ct.info.Shell}');"><i class="fa fa-terminal" aria-hidden="true"></i> ${$.i18n('console')}</a></li>`
                                                : ''}
                                                ${!ct.info.State.Running ? `<li><a onclick="event.preventDefault(); eventControl({action:'start', container:'${ct.shortId}'}, 'loadlist');"><i class="fa fa-play" aria-hidden="true"></i> ${$.i18n('start')}</a></li>` : 
                                                    `${ct.info.State.Paused ? `<li><a onclick="event.preventDefault(); eventControl({action:'resume', container:'${ct.shortId}'}, 'loadlist');"><i class="fa fa-play" aria-hidden="true"></i> ${$.i18n('resume')}</a></li>` : 
                                                        `<li><a onclick="event.preventDefault(); eventControl({action:'stop', container:'${ct.shortId}'}, 'loadlist');"><i class="fa fa-stop" aria-hidden="true"></i> ${$.i18n('stop')}</a></li>
                                                         <li><a onclick="event.preventDefault(); eventControl({action:'pause', container:'${ct.shortId}'}, 'loadlist');"><i class="fa fa-pause" aria-hidden="true"></i> ${$.i18n('pause')}</a></li>`}
                                                <li><a onclick="event.preventDefault(); eventControl({action:'restart', container:'${ct.shortId}'}, 'loadlist');"><i class="fa fa-refresh" aria-hidden="true"></i> ${$.i18n('restart')}</a></li>`}
                                                <li><a onclick="event.preventDefault(); openTerminal('docker', '${ct.info.Name}', '.log');"><i class="fa fa-navicon" aria-hidden="true"></i> ${$.i18n('logs')}</a></li>
                                                ${ct.info.template ? `<li><a onclick="event.preventDefault(); editContainer('${ct.info.Name}', '${ct.info.template.path}');"><i class="fa fa-wrench" aria-hidden="true"></i> ${$.i18n('edit')}</a></li>` : ''}
                                                <li><a onclick="event.preventDefault(); rmContainer('${ct.info.Name}', '${ct.shortImageId}', '${ct.shortId}');"><i class="fa fa-trash" aria-hidden="true"></i> ${$.i18n('remove')}</a></li>
                                            </ul>
                                        </div>
                                        <div class="action-right">
                                            <ul class="fa-ul">
                                                ${ct.info.ReadMe ? `<li><a href="${htmlEscape(ct.info.ReadMe)}" target="_blank"><i class="fa fa-book" aria-hidden="true"></i> ${$.i18n('read-me-first')}</a></li>` : ''}
                                                ${ct.info.Project ? `<li><a href="${htmlEscape(ct.info.Project)}" target="_blank"><i class="fa fa-life-ring" aria-hidden="true"></i> ${$.i18n('project-page')}</a></li>` : ''}
                                                ${ct.info.Support ? `<li><a href="${htmlEscape(ct.info.Support)}" target="_blank"><i class="fa fa-question" aria-hidden="true"></i> ${$.i18n('support')}</a></li>` : ''}
                                                ${ct.info.registry ? `<li><a href="${htmlEscape(ct.info.registry)}" target="_blank"><i class="fa fa-info-circle" aria-hidden="true"></i> ${$.i18n('more-info')}</a></li>` : ''}
                                                ${ct.info.DonateLink ? `<li><a href="${htmlEscape(ct.info.DonateLink)}" target="_blank"><i class="fa fa-usd" aria-hidden="true"></i> ${$.i18n('donate')}</a></li>` : ''}
                                            </ul>
                                        </div>
                                    </div>
                                    <div class="info-ct">
                                        <span class="container-id">${$.i18n('container-id')}: ${ct.shortId}</span><br>
                                        <span class="repo">${$.i18n('by')}: <a target="_blank" ${ct.info.registry ? `href="${htmlEscape(ct.info.registry)}"` : ''} >${ct.info.Config.Image.split(':').shift()}</a></span>
                                    </div>
                                </div>
                                <div class="info-section">
                                    <ul class="info-tabs">
                                        <li><a class="tabs-graph localURL" href="#comb-grapth-${ct.shortId}">${$.i18n('graph')}</a></li>
                                        <li><a class="tabs-cpu-graph localURL" href="#cpu-grapth-${ct.shortId}">${$.i18n('cpu-graph')}</a></li>
                                        <li><a class="tabs-mem-graph localURL" href="#mem-grapth-${ct.shortId}">${$.i18n('mem-graph')}</a></li>
                                        <li><a class="tabs-ports localURL" href="#info-ports-${ct.shortId}">${$.i18n('port-mappings')}</a></li>
                                        <li><a class="tabs-volumes localURL" href="#info-volumes-${ct.shortId}">${$.i18n('volume-mappings')}</a></li>
                                    </ul>
                                    <div class="comb-grapth-${ct.shortId} comb-stat-grapth" id="comb-grapth-${ct.shortId}" style="display: none;"><canvas></canvas></div>
                                    <div class="cpu-grapth-${ct.shortId} cpu-stat-grapth" id="cpu-grapth-${ct.shortId}" style="display: none;"><canvas></canvas></div>
                                    <div class="mem-grapth-${ct.shortId} mem-stat-grapth" id="mem-grapth-${ct.shortId}" style="display: none;"><canvas></canvas></div>
                                    <div class="info-ports" id="info-ports-${ct.shortId}" style="display: none;">${ct.info.Ports?.length > 10 ? (`<span class="info-ports-more" style="display: none;">${ct.info.Ports?.map(e=>`${e.PrivateIP ? e.PrivateIP + ':' : ''}${e.PrivatePort}/${e.Type.toUpperCase()} <i class="fa fa-arrows-h"></i> ${e.PublicIP ? e.PublicIP + ':' : ''}${e.PublicPort}`).join('<br>') || ''}<br><a onclick="event.preventDefault(); $(this).parent().css('display', 'none').siblings('.info-ports-less').css('display', 'inline')">${$.i18n('compress')}</a></span><span class="info-ports-less">${ct.info.Ports?.slice(0,10).map(e=>`${e.PrivateIP ? e.PrivateIP + ':' : ''}${e.PrivatePort}/${e.Type.toUpperCase()} <i class="fa fa-arrows-h"></i> ${e.PublicIP ? e.PublicIP + ':' : ''}${e.PublicPort}`).join('<br>') || ''}<br><a onclick="event.preventDefault(); $(this).parent().css('display', 'none').siblings('.info-ports-more').css('display', 'inline')">${$.i18n('expand')}</a></span>`) : (`<span class="info-ports-mono">${ct.info.Ports?.map(e=>`${e.PrivateIP ? e.PrivateIP + ':' : ''}${e.PrivatePort}/${e.Type.toUpperCase()} <i class="fa fa-arrows-h"></i> ${e.PublicIP ? e.PublicIP + ':' : ''}${e.PublicPort}`).join('<br>') || ''}</span>`)}</div>
                                    <div class="info-volumes" id="info-volumes-${ct.shortId}" style="display: none;">${ct.Mounts?.filter(e => e.Type==='bind').length > 10 ? (`<span class="info-volumes-more" style="display: none;">${ct.Mounts?.filter(e => e.Type==='bind').map(e=>`${e.Destination} <i class="fa fa-arrows-h"></i> ${e.Source}`).join('<br>') || ''}<br><a onclick="event.preventDefault(); $(this).parent().css('display', 'none').siblings('.info-volumes-less').css('display', 'inline')">${$.i18n('compress')}</a></span><span class="info-volumes-less">${ct.Mounts?.filter(e => e.Type==='bind').slice(0,10).map(e=>`${e.Destination} <i class="fa fa-arrows-h"></i> ${e.Source}`).join('<br>') || ''}<br><a onclick="event.preventDefault(); $(this).parent().css('display', 'none').siblings('.info-volumes-more').css('display', 'inline')">${$.i18n('expand')}</a></span>`) : (`<span class="info-volumes-mono">${ct.Mounts?.filter(e => e.Type==='bind').map(e=>`${e.Destination} <i class="fa fa-arrows-h"></i> ${e.Source}`).join('<br>') || ''}</span>`)}</div>
                                </div>
                            </div>
                        </div>
                    `)
                });
            } else {
                 folderWarn(`createFolder (id: ${id}), container ${ct.shortId}: tooltip_trigger_element is NOT valid. Tooltipster NOT initialized. This is likely the problem if folder.settings.context === 2.`);
            }

            newFolder[container_name_in_folder] = {
                id: ct.shortId,
                pause: ct.info.State.Paused,
                state: ct.info.State.Running,
                update: ct.info.State.Updated === false,
                managed: ct.info.State.manager === 'dockerman'
            };
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Stored in newFolder:`, JSON.parse(JSON.stringify(newFolder[container_name_in_folder])));
            const elementForPreviewOpts = $(`tr.folder-id-${id} div.folder-preview > span:last`); // Re-check if this is always correct
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Preview element for options:`, elementForPreviewOpts[0]);
            let sel_preview_opt;
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Applying preview options based on folder.settings:`, JSON.parse(JSON.stringify(folder.settings)));
            const $previewElementTarget = $(`tr.folder-id-${id} div.folder-preview > span:last`); // Or elementForPreviewOpts if you prefer
            let $targetForAppend; // Used for WebUI, Console, Logs icons

            if (folder.settings.preview_grayscale) {
                let $imgToGrayscale = $previewElementTarget.children('span.hand').children('img.img');
                if (!$imgToGrayscale.length) {
                    $imgToGrayscale = $previewElementTarget.children('img.img');
                }
                if ($imgToGrayscale.length) {
                    $imgToGrayscale.css('filter', 'grayscale(100%)');
                    folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Applied grayscale to preview image.`);
                } else {
                    folderWarn(`createFolder (id: ${id}), container ${container_name_in_folder}: Grayscale: Could not find image in preview element.`);
                }
            }

            if (folder.settings.preview_update && !ct.info.State.Updated) {
                let $appNameSpan = $previewElementTarget.children('span.inner').children('span.appname');
                if (!$appNameSpan.length) {
                    $appNameSpan = $previewElementTarget.children('span.appname');
                }
                if ($appNameSpan.length) {
                    $appNameSpan.addClass('orange-text');
                    $appNameSpan.children('a.exec').addClass('orange-text');
                    folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Applied orange-text for update status to preview appname.`);
                } else {
                     folderWarn(`createFolder (id: ${id}), container ${container_name_in_folder}: Update style: Could not find appname span in preview element.`);
                }
            }

            // Determine the element to append WebUI/Console/Logs icons to
            $targetForAppend = $previewElementTarget.children('span.inner').last();
            if (!$targetForAppend.length) {
                $targetForAppend = $previewElementTarget; // Fallback to the main span if no inner span
            }

            if (folder.settings.preview_webui && ct.info.State.WebUi) {
                if ($targetForAppend.length) {
                    $targetForAppend.append($(`<span class="folder-element-custom-btn folder-element-webui"><a href="${htmlEscape(ct.info.State.WebUi)}" target="_blank"><i class="fa fa-globe" aria-hidden="true"></i></a></span>`));
                    folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Appended WebUI icon to preview.`);
                } else {
                     folderWarn(`createFolder (id: ${id}), container ${container_name_in_folder}: WebUI icon: Could not find target for append in preview element.`);
                }
            }

            if (folder.settings.preview_console) {
                if ($targetForAppend.length) {
                    $targetForAppend.append($(`<span class="folder-element-custom-btn folder-element-console"><a href="#" onclick="event.preventDefault(); openTerminal('docker', '${ct.info.Name}', '${ct.info.Shell}');"><i class="fa fa-terminal" aria-hidden="true"></i></a></span>`));
                    folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Appended Console icon to preview.`);
                } else {
                     folderWarn(`createFolder (id: ${id}), container ${container_name_in_folder}: Console icon: Could not find target for append in preview element.`);
                }
            }

            if (folder.settings.preview_logs) {
                if ($targetForAppend.length) {
                    // Use ct.info.Name for consistency, as 'container_name_in_folder' is the same.
                    $targetForAppend.append($(`<span class="folder-element-custom-btn folder-element-logs"><a href="#" onclick="event.preventDefault(); openTerminal('docker', '${ct.info.Name}', '.log');"><i class="fa fa-bars" aria-hidden="true"></i></a></span>`));
                    folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Appended Logs icon to preview.`);
                } else {
                    folderWarn(`createFolder (id: ${id}), container ${container_name_in_folder}: Logs icon: Could not find target for append in preview element.`);
                }
            }

            upToDate = upToDate && !newFolder[container_name_in_folder].update;
            started += newFolder[container_name_in_folder].state ? 1 : 0;
            autostart += !(ct.info.State.Autostart === false) ? 1 : 0;
            autostartStarted += ((!(ct.info.State.Autostart === false)) && newFolder[container_name_in_folder].state) ? 1 : 0;
            managed += newFolder[container_name_in_folder].managed ? 1 : 0;
            folderLog(`createFolder (id: ${id}), container ${container_name_in_folder}: Updated folder aggregate states:`, { upToDate, started, autostart, autostartStarted, managed });
            folderEvents.dispatchEvent(new CustomEvent('docker-post-folder-preview', {detail: {
                folder: folder,
                id: id,
                position: positionInMainOrder,
                order: liveOrderArray,
                containersInfo: containersInfo,
                foldersDone: foldersDone, // Original foldersDone
                container: container_name_in_folder,
                ct: ct,
                index: indexInCustomOrder,
                offsetIndex: indexInLiveOrderArray,
                states: {
                    upToDate,
                    started,
                    autostart,
                    autostartStarted,
                    managed
                }
            }}));
        } else {
            folderWarn(`createFolder (id: ${id}): Container TR for '${container_name_in_folder}' NOT FOUND in the sortable list. It might have been moved by another folder or an error occurred. Skipping.`);
        }
    }
    folderLog(`createFolder (id: ${id}): Finished loop over combinedContainers. Final remBefore for this folder = ${remBefore}`);
    $(`.folder-${id}-element:last`).css('border-bottom', `1px solid ${folder.settings.preview_border_color}`);
    folderLog(`createFolder (id: ${id}): Set border-bottom on last .folder-${id}-element.`);
    folder.containers = newFolder;
    folderLog(`createFolder (id: ${id}): Replaced folder.containers with newFolder:`, JSON.parse(JSON.stringify(newFolder)));
    $(`tr.folder-id-${id} div.folder-storage span.outer`).get().forEach((e) => {
        folderobserver.observe(e, folderobserverConfig);
    });
    folderLog(`createFolder (id: ${id}): Attached folderobserver to .folder-storage span.outer elements.`);
    $(`tr.folder-id-${id} div.folder-preview > span`).wrap('<div class="folder-preview-wrapper"></div>');
    folderLog(`createFolder (id: ${id}): Wrapped preview spans with .folder-preview-wrapper.`);
    if(folder.settings.preview_vertical_bars) {
        $(`tr.folder-id-${id} div.folder-preview > div`).after(`<div class="folder-preview-divider" style="border-color: ${folder.settings.preview_border_color};"></div>`);
        folderLog(`createFolder (id: ${id}): Added preview_vertical_bars.`);
    }
    if(folder.settings.update_column) {
        $(`tr.folder-id-${id} > td.updatecolumn`).next().attr('colspan',6).end().remove();
        folderLog(`createFolder (id: ${id}): Handled update_column setting (removed column).`);
    }
    if(managed === 0) {
        $(`tr.folder-id-${id} > td.updatecolumn > div.advanced`).remove();
        folderLog(`createFolder (id: ${id}): No managed containers, removed advanced update div.`);
    }

    folderLog(`createFolder (id: ${id}): Setting folder status indicators based on aggregate states.`);
    if (!upToDate) {
        $(`tr.folder-id-${id} > td.updatecolumn > span`).replaceWith($(`<div class="advanced" style="display: ${advanced ? 'block' : 'none'};"><span class="orange-text folder-update-text" style="white-space:nowrap;"><i class="fa fa-flash fa-fw"></i> ${$.i18n('update-ready')}</span></div>`));
        $(`tr.folder-id-${id} > td.updatecolumn > div.advanced:has(a)`).remove();
        $(`tr.folder-id-${id} > td.updatecolumn`).append($(`<a class="exec" onclick="updateFolder('${id}');"><span style="white-space:nowrap;"><i class="fa fa-cloud-download fa-fw"></i> ${$.i18n('apply-update')}</span></a>`));
        folderLog(`createFolder (id: ${id}): Set 'update ready' status in update column.`);
    }
    if (started) {
        $(`tr.folder-id-${id} i#load-folder-${id}`).attr('class', 'fa fa-play started green-text folder-load-status');
        $(`tr.folder-id-${id} span.folder-state`).text(`${started}/${Object.entries(folder.containers).length} ${$.i18n('started')}`);
        folderLog(`createFolder (id: ${id}): Set 'started' status. Count: ${started}/${Object.entries(folder.containers).length}.`);
    }
    if (autostart) {
        $(`#folder-${id}-auto`).next().click();
        folderLog(`createFolder (id: ${id}): At least one container has autostart. Clicked folder autostart switch ON. Autostart count: ${autostart}`);
    }

    if(autostart === 0) { $(`tr.folder-id-${id}`).addClass('no-autostart'); }
    else if (autostart > 0 && autostartStarted === 0) { $(`tr.folder-id-${id}`).addClass('autostart-off'); }
    else if (autostart > 0 && autostartStarted > 0 && autostart !== autostartStarted) { $(`tr.folder-id-${id}`).addClass('autostart-partial'); }
    else if (autostart > 0 && autostartStarted > 0 && autostart === autostartStarted) { $(`tr.folder-id-${id}`).addClass('autostart-full'); }
    folderLog(`createFolder (id: ${id}): Applied autostart status class. Autostart: ${autostart}, AutostartStarted: ${autostartStarted}.`);
    if(managed === 0) { $(`tr.folder-id-${id}`).addClass('no-managed'); }
    else if (managed > 0 && managed < Object.values(folder.containers).length) { $(`tr.folder-id-${id}`).addClass('managed-partial'); }
    else if (managed > 0 && managed === Object.values(folder.containers).length) { $(`tr.folder-id-${id}`).addClass('managed-full'); }
    folderLog(`createFolder (id: ${id}): Applied managed status class. Managed: ${managed}, Total: ${Object.values(folder.containers).length}.`);
    folder.status = { upToDate, started, autostart, autostartStarted, managed, expanded: false };
    folderLog(`createFolder (id: ${id}): Set final folder.status object:`, JSON.parse(JSON.stringify(folder.status)));
    $(`#folder-${id}-auto`).on("change", folderAutostart);
    folderLog(`createFolder (id: ${id}): Attached 'change' event to folder autostart switch.`);
    folderLog(`createFolder (id: ${id}): Dispatching docker-post-folder-creation event.`);
    folderEvents.dispatchEvent(new CustomEvent('docker-post-folder-creation', {detail: {
        folder: folder,
        id: id,
        position: positionInMainOrder,
        order: liveOrderArray,
        containersInfo: containersInfo,
        foldersDone: foldersDone
    }}));

    folderLog(`createFolder (id: ${id}): Exit. Returning remBefore = ${remBefore}`);
    return remBefore;
};

/**
 * Function to hide all tooltips
 */
const hideAllTips = () => {
    folderLog('hideAllTips: Entry');
    let tips = $.tooltipster.instances();
    folderLog('hideAllTips: Found tooltipster instances:', tips.length);
    $.each(tips, function(i, instance){
        folderLog(`hideAllTips: Closing instance ${i}`);
        instance.close();
    });
    folderLog('hideAllTips: Exit');
};

/**
 * Function to set the atuostart of a container in the advanced tooltip
 * @param {*} el element passed by the event caller
 */
const advancedAutostart = (el) => {
    folderLog('advancedAutostart: Entry. Event target:', el.target);
    const outbox = $(el.target).parents('.preview-outbox')[0];
    const ctid = outbox.className.match(/preview-outbox-([a-zA-Z0-9]+)/)[1]; // Ensure ctid is captured correctly
    folderLog('advancedAutostart: outbox:', outbox, `ctid: ${ctid}`);
    $(`#${ctid}`).parents('.folder-element').find('.switch-button-background').click();
    folderLog(`advancedAutostart: Clicked main autostart switch for container ${ctid}. Exit.`);
};

/**
 * Hanled the click of the autostart button and changes the container to reflect the status of the folder
 * @param {*} el element passed by the event caller
 */
const folderAutostart = (el) => {
    folderLog('folderAutostart: Entry. Event target:', el.target);
    const status = el.target.checked;
    // The id is needded to get the containers, the checkbox has a id folder-${id}-auto, so split and take the second element
    const id = el.target.id.split('-')[1];
    folderLog(`folderAutostart: Folder ID: ${id}, New Status: ${status}`);
    const containers = $(`.folder-${id}-element`);
    folderLog(`folderAutostart: Found ${containers.length} containers in folder ${id}.`);
    for (const container of containers) {
        // Select the td with the switch inside
        const switchTd = $(container).children('td.advanced').next(); // This should be the autostart TD
        const containerAutostartCheckbox = $(switchTd).find('input.autostart')[0];

        if (containerAutostartCheckbox) {
            const cstatus = containerAutostartCheckbox.checked;
            folderLog(`folderAutostart: Container ${$(container).find('.appname a').text().trim() || 'N/A'}: current autostart=${cstatus}. Folder target status=${status}`);
            if ((status && !cstatus) || (!status && cstatus)) {
                 folderLog(`folderAutostart: Clicking autostart switch for container.`);
                $(switchTd).children('.switch-button-background').click();
            }
        } else {
            folderWarn(`folderAutostart: Could not find autostart checkbox for a container in folder ${id}. TD element:`, switchTd[0]);
        }
    }
    folderLog(`folderAutostart (id: ${id}): Exit.`);
};

/**
 * Handle the dropdown expand button of folders
 * @param {string} id the id of the folder
 */
const dropDownButton = (id) => {
    folderLog(`dropDownButton (id: ${id}): Entry.`);
    folderLog(`dropDownButton (id: ${id}): Dispatching docker-pre-folder-expansion event.`);
    folderEvents.dispatchEvent(new CustomEvent('docker-pre-folder-expansion', {detail: { id }}));
    const element = $(`.dropDown-${id}`);
    const state = element.attr('active') === "true";
    folderLog(`dropDownButton (id: ${id}): Current state (active attribute): ${state}.`);
    if (state) { // Is expanded, so collapse
        element.children().removeClass('fa-chevron-up').addClass('fa-chevron-down');
        $(`tr.folder-id-${id}`).addClass('sortable');
        $(`tr.folder-id-${id} .folder-storage`).append($(`.folder-${id}-element`));
        element.attr('active', 'false');
        folderLog(`dropDownButton (id: ${id}): Collapsed folder. Moved elements to storage.`);
    } else { // Is collapsed, so expand
        element.children().removeClass('fa-chevron-down').addClass('fa-chevron-up');
        $(`tr.folder-id-${id}`).removeClass('sortable').removeClass('ui-sortable-handle').off().css('cursor', '');
        $(`tr.folder-id-${id}`).after($(`.folder-${id}-element`));
        $(`.folder-${id}-element > td > i.fa-arrows-v`).remove(); // Remove mover icon from children when expanded
        element.attr('active', 'true');
        folderLog(`dropDownButton (id: ${id}): Expanded folder. Moved elements after folder row.`);
    }
    if(globalFolders[id]) {
        globalFolders[id].status.expanded = !state;
        folderLog(`dropDownButton (id: ${id}): Updated globalFolders[${id}].status.expanded to ${!state}.`);
    } else {
        folderWarn(`dropDownButton (id: ${id}): globalFolders[${id}] not found to update expanded status.`);
    }
    folderLog(`dropDownButton (id: ${id}): Dispatching docker-post-folder-expansion event.`);
    folderEvents.dispatchEvent(new CustomEvent('docker-post-folder-expansion', {detail: { id }}));
    folderLog(`dropDownButton (id: ${id}): Exit.`);
};

/**
 * Removie the folder
 * @param {string} id the id of the folder
 */
const rmFolder = (id) => {
    folderLog(`rmFolder (id: ${id}): Entry.`);
    // Ask for a confirmation
    swal({
        title: $.i18n('are-you-sure'),
        text: `${$.i18n('remove-folder')}: ${globalFolders[id].name}`,
        type: 'warning',
        html: true,
        showCancelButton: true,
        confirmButtonText: $.i18n('yes-delete'),
        cancelButtonText: $.i18n('cancel'),
        showLoaderOnConfirm: true
    },
    async (c) => {
        folderLog(`rmFolder (id: ${id}): Swal callback. Confirmed: ${c}`);
        if (!c) { setTimeout(loadlist, 0); return; } // Use timeout 0 for consistency
        $('div.spinner.fixed').show('slow');
        folderLog(`rmFolder (id: ${id}): Calling delete API.`);
        await $.post('/plugins/unraid-folderview/server/delete.php', { type: 'docker', id: id, csrf_token: csrf_token }).promise();
        folderLog(`rmFolder (id: ${id}): Delete API call finished. Reloading list.`);
        setTimeout(loadlist, 500);
    });
};

/**
 * Redirect to the page to edit the folder
 * @param {string} id the id of the folder
 */
const editFolder = (id) => {
    folderLog(`editFolder (id: ${id}): Redirecting to edit page.`);
    location.href = "/Docker/Folder?type=docker&id=" + id;
};

/**
 * Force update all the containers inside a folder
 * @param {string} id the id of the folder
 */
const forceUpdateFolder = (id) => {
    folderLog(`forceUpdateFolder (id: ${id}): Entry.`);
    hideAllTips();
    const folder = globalFolders[id];
    folderLog(`forceUpdateFolder (id: ${id}): Folder data:`, {...folder});
    const containersToUpdate = Object.entries(folder.containers).filter(([k, v]) => v.managed).map(e => e[0]).join('*');
    folderLog(`forceUpdateFolder (id: ${id}): Containers to force update: ${containersToUpdate}. Calling openDocker.`);
    openDocker('update_container ' + containersToUpdate, $.i18n('updating', folder.name),'','loadlist');
};

/**
 * Update all the updatable containers inside a folder
 * @param {string} id the id of the folder
 */
const updateFolder = (id) => {
    folderLog(`updateFolder (id: ${id}): Entry.`);
    hideAllTips();
    const folder = globalFolders[id];
    folderLog(`updateFolder (id: ${id}): Folder data:`, {...folder});
    const containersToUpdate = Object.entries(folder.containers).filter(([k, v]) => v.managed && v.update).map(e => e[0]).join('*');
    folderLog(`updateFolder (id: ${id}): Containers to update (ready): ${containersToUpdate}. Calling openDocker.`);
    openDocker('update_container ' + containersToUpdate, $.i18n('updating', folder.name),'','loadlist');
};

/**
 * Perform an action for the entire folder
 * @param {string} id The id of the folder
 * @param {string} action the desired action
 */
const actionFolder = async (id, action) => {
    folderLog(`actionFolder (id: ${id}, action: ${action}): Entry.`);
    const folder = globalFolders[id];
    if (!folder || !folder.containers) {
        folderWarn(`actionFolder (id: ${id}): Folder or folder.containers not found in globalFolders.`);
        $('div.spinner.fixed').hide('slow');
        return;
    }
    const cts = Object.keys(folder.containers);
    let proms = [];
    let errors;

    folderLog(`actionFolder (id: ${id}): Folder data:`, {...folder}, "Containers to act on:", cts);
    $(`i#load-folder-${id}`).removeClass('fa-play fa-square fa-pause').addClass('fa-refresh fa-spin');
    $('div.spinner.fixed').show('slow');

    for (let index = 0; index < cts.length; index++) {
        const containerName = cts[index];
        const ct = folder.containers[containerName];
        if (!ct) {
            folderWarn(`actionFolder (id: ${id}): Container data for '${containerName}' not found in folder.containers.`);
            continue;
        }
        const cid = ct.id;
        let pass = false; // Default to false
        folderLog(`actionFolder (id: ${id}): Processing container ${containerName} (cid: ${cid}). State: ${ct.state}, Paused: ${ct.pause}.`);
        switch (action) {
            case "start":
                pass = !ct.state;
                break;
            case "stop":
                pass = ct.state;
                break;
            case "pause":
                pass = ct.state && !ct.pause;
                break;
            case "resume":
                pass = ct.state && ct.pause;
                break;
            case "restart":
                pass = true;
                break;
            default:
                pass = false; // Should not happen with predefined actions
                folderWarn(`actionFolder (id: ${id}): Unknown action '${action}'.`);
                break;
        }
        folderLog(`actionFolder (id: ${id}): Container ${containerName} - action '${action}', pass condition: ${pass}.`);
        if(pass) {
            folderLog(`actionFolder (id: ${id}): Pushing POST request for container ${cid}, action ${action}.`);
            proms.push($.post(eventURL, {action: action, container:cid}, null,'json').promise());
        }
    }

    folderLog(`actionFolder (id: ${id}): Awaiting ${proms.length} promises.`);
    const results = await Promise.all(proms);
    folderLog(`actionFolder (id: ${id}): Promises resolved. Results:`, results);
    errors = results.filter(e => e.success !== true);
    folderLog(`actionFolder (id: ${id}): Filtered errors:`, errors);
    // errors = errors.map(e => e.success); // This line seems to map to boolean, original used `e.text` or similar for swal

    if(errors.length > 0) {
        const errorMessages = errors.map(e => e.text || JSON.stringify(e)); // Get error text or stringify if not present
        folderWarn(`actionFolder (id: ${id}): Execution errors occurred:`, errorMessages);
        swal({
            title: $.i18n('exec-error'),
            text:errorMessages.join('<br>'),
            type:'error',
            html:true,
            confirmButtonText:'Ok'
        }, loadlist);
    } else {
        folderLog(`actionFolder (id: ${id}): No errors. Reloading list.`);
        loadlist();
    }
    $('div.spinner.fixed').hide('slow');
    folderLog(`actionFolder (id: ${id}): Exit.`);
};

/**
 * Execute the desired custom action
 * @param {string} id
 * @param {number} actionIndex
 */
const folderCustomAction = async (id, actionIndex) => {
    folderLog(`folderCustomAction (id: ${id}, actionIndex: ${actionIndex}): Entry.`);
    $('div.spinner.fixed').show('slow');
    const folder = globalFolders[id];
    if (!folder || !folder.actions || !folder.actions[actionIndex]) {
        folderWarn(`folderCustomAction: Folder or action definition not found for id ${id}, actionIndex ${actionIndex}.`);
        $('div.spinner.fixed').hide('slow');
        loadlist();
        return;
    }
    let act = folder.actions[actionIndex];
    folderLog(`folderCustomAction (id: ${id}): Action details:`, {...act});
    let prom = [];

    if(act.type === 0) { // Standard Docker action
        folderLog(`folderCustomAction (id: ${id}): Action type 0 (Standard Docker).`);
        // act.conatiners is an array of names. Need to map to folder.containers[name]
        const cts = act.conatiners.map(name => folder.containers[name]).filter(e => e);
        folderLog(`folderCustomAction (id: ${id}): Targeted containers data:`, [...cts]);
        let ctAction = (e) => {}; // Placeholder
        if(act.action === 0) { // Cycle
            folderLog(`folderCustomAction (id: ${id}): Standard action type 0 (Cycle). Mode: ${act.modes}.`);
            if(act.modes === 0) { // Start - Stop
                ctAction = (e_ct) => {
                    folderLog(`folderCustomAction (Cycle Start-Stop for ${e_ct.id}): State: ${e_ct.state}`);
                    if(e_ct.state) { // if running
                        prom.push($.post(eventURL, {action: 'stop', container:e_ct.id}, null,'json').promise());
                    } else { // if stopped
                        prom.push($.post(eventURL, {action: 'start', container:e_ct.id}, null,'json').promise());
                    }
                };
            } else if(act.modes === 1) { // Pause - Resume
                ctAction = (e_ct) => {
                    folderLog(`folderCustomAction (Cycle Pause-Resume for ${e_ct.id}): State: ${e_ct.state}, Paused: ${e_ct.pause}`);
                    if(e_ct.state) { // if running (can be paused or not)
                        if(e_ct.pause) { // if paused
                            prom.push($.post(eventURL, {action: 'resume', container:e_ct.id}, null,'json').promise());
                        } else { // if running but not paused
                            prom.push($.post(eventURL, {action: 'pause', container:e_ct.id}, null,'json').promise());
                        }
                    }
                };
            }
        } else if(act.action === 1) { // Set
            folderLog(`folderCustomAction (id: ${id}): Standard action type 1 (Set). Mode: ${act.modes}.`);
            if(act.modes === 0) { // Start
                ctAction = (e_ct) => {
                    folderLog(`folderCustomAction (Set Start for ${e_ct.id}): State: ${e_ct.state}`);
                    if(!e_ct.state) { prom.push($.post(eventURL, {action: 'start', container:e_ct.id}, null,'json').promise()); }
                };
            } else if(act.modes === 1) { // Stop
                ctAction = (e_ct) => {
                    folderLog(`folderCustomAction (Set Stop for ${e_ct.id}): State: ${e_ct.state}`);
                    if(e_ct.state) { prom.push($.post(eventURL, {action: 'stop', container:e_ct.id}, null,'json').promise()); }
                };
            } else if(act.modes === 2) { // Pause
                ctAction = (e_ct) => {
                    folderLog(`folderCustomAction (Set Pause for ${e_ct.id}): State: ${e_ct.state}, Paused: ${e_ct.pause}`);
                    if(e_ct.state && !e_ct.pause) { prom.push($.post(eventURL, {action: 'pause', container:e_ct.id}, null,'json').promise()); }
                };
            } else if(act.modes === 3) { // Resume
                ctAction = (e_ct) => {
                     folderLog(`folderCustomAction (Set Resume for ${e_ct.id}): State: ${e_ct.state}, Paused: ${e_ct.pause}`);
                    if(e_ct.state && e_ct.pause) { prom.push($.post(eventURL, {action: 'resume', container:e_ct.id}, null,'json').promise()); }
                };
            }
        } else if(act.action === 2) { // Restart
            folderLog(`folderCustomAction (id: ${id}): Standard action type 2 (Restart).`);
            ctAction = (e_ct) => {
                folderLog(`folderCustomAction (Restart for ${e_ct.id})`);
                prom.push($.post(eventURL, {action: 'restart', container:e_ct.id}, null,'json').promise());
            };
        }
        cts.forEach((e_ct_data) => { // e_ct_data is like {id: "...", state: true, ...}
            folderLog(`folderCustomAction (id: ${id}): Applying defined ctAction to container data:`, e_ct_data);
            ctAction(e_ct_data);
        });
        folderLog(`folderCustomAction (id: ${id}): Pushed ${prom.length} standard actions to promise array.`);
    } else if(act.type === 1) { // User Script
        folderLog(`folderCustomAction (id: ${id}): Action type 1 (User Script). Script: ${act.script}, Sync: ${act.script_sync}, Args: ${act.script_args}`);
        const args = act.script_args || '';
        if(act.script_sync) { // Synchronous (foreground) script
            let scriptVariables = {};
            folderLog(`folderCustomAction (id: ${id}): Sync script. Getting script variables.`);
            let rawVars = await $.post("/plugins/user.scripts/exec.php",{action:'getScriptVariables',script:`/boot/config/plugins/user.scripts/scripts/${act.script}/script`}).promise();
            folderLog(`folderCustomAction (id: ${id}): Raw script variables:`, rawVars);
            rawVars.trim().split('\n').forEach((e) => { const variable = e.split('='); scriptVariables[variable[0]] = variable[1] });
            folderLog(`folderCustomAction (id: ${id}): Parsed script variables:`, scriptVariables);
            if(scriptVariables['directPHP']) {
                folderLog(`folderCustomAction (id: ${id}): directPHP detected. Posting directRunScript.`);
                // This is a POST that then has a callback to openBox. It's not added to `prom`.
                $.post("/plugins/user.scripts/exec.php",{action:'directRunScript',path:`/boot/config/plugins/user.scripts/scripts/${act.script}/script`},function(data) {
                    folderLog(`folderCustomAction (id: ${id}): directRunScript callback. Data:`, data);
                    if(data) { openBox(data,act.name,800,1200, 'loadlist'); }
                });
            } else {
                folderLog(`folderCustomAction (id: ${id}): Not directPHP. Posting convertScript then openBox.`);
                // This is also a POST with a callback. Not added to `prom`.
                $.post("/plugins/user.scripts/exec.php",{action:'convertScript',path:`/boot/config/plugins/user.scripts/scripts/${act.script}/script`},function(data) {
                     folderLog(`folderCustomAction (id: ${id}): convertScript callback. Data:`, data);
                    if(data) {openBox('/plugins/user.scripts/startScript.sh&arg1='+data+'&arg2='+args,act.name,800,1200,true, 'loadlist');}
                });
            }
        } else { // Asynchronous (background) script
            folderLog(`folderCustomAction (id: ${id}): Async script. Posting convertScript then GET logging.htm.`);
            const cmd = await $.post("/plugins/user.scripts/exec.php",{action:'convertScript', path:`/boot/config/plugins/user.scripts/scripts/${act.script}/script`}).promise();
            folderLog(`folderCustomAction (id: ${id}): Converted script cmd:`, cmd);
            prom.push($.get('/logging.htm?cmd=/plugins/user.scripts/backgroundScript.sh&arg1='+cmd+'&arg2='+args+'&csrf_token='+csrf_token+'&done=Done').promise());
            folderLog(`folderCustomAction (id: ${id}): Pushed async script call to promise array.`);
        }
    }

    folderLog(`folderCustomAction (id: ${id}): Awaiting ${prom.length} promises for custom action.`);
    await Promise.all(prom);
    folderLog(`folderCustomAction (id: ${id}): All promises resolved. Reloading list.`);
    loadlist();
    $('div.spinner.fixed').hide('slow');
    folderLog(`folderCustomAction (id: ${id}): Exit.`);
};


/**
 * Atach the menu when clicking the folder icon
 * @param {string} id the id of the folder
 */
const addDockerFolderContext = (id) => {
    folderLog(`addDockerFolderContext (id: ${id}): Entry.`);
    let opts = [];

    context.settings({
        right: false,
        above: false
    });
    folderLog(`addDockerFolderContext (id: ${id}): Context menu settings configured.`);
    if (!globalFolders[id]) {
        folderWarn(`addDockerFolderContext (id: ${id}): Folder data not found in globalFolders. Aborting context menu.`);
        return;
    }
    const folderData = globalFolders[id];
    folderLog(`addDockerFolderContext (id: ${id}): Folder data:`, {...folderData});
    if(folderData.settings.override_default_actions && folderData.actions && folderData.actions.length) {
        folderLog(`addDockerFolderContext (id: ${id}): Overriding default actions with ${folderData.actions.length} custom actions.`);
        opts.push(
            ...folderData.actions.map((e, i) => {
                return {
                    text: e.name,
                    icon: e.script_icon || "fa-bolt",
                    action: (evt) => { evt.preventDefault(); folderCustomAction(id, i); } // evt for event
                }
            })
        );
        opts.push({ divider: true });
    } else if(!folderData.settings.default_action) { // if default actions are NOT hidden
        folderLog(`addDockerFolderContext (id: ${id}): Adding default action menu items.`);
        opts.push({
            text: $.i18n('start'),
            icon: 'fa-play',
            action: (evt) => { evt.preventDefault(); actionFolder(id, "start"); }
        });
        opts.push({
            text: $.i18n('stop'),
            icon: 'fa-stop',
            action: (evt) => { evt.preventDefault(); actionFolder(id, "stop"); }
        });
        opts.push({
            text: $.i18n('pause'),
            icon: 'fa-pause',
            action: (evt) => { evt.preventDefault(); actionFolder(id, "pause"); }
        });
        opts.push({
            text: $.i18n('resume'),
            icon: 'fa-play-circle',
            action: (evt) => { evt.preventDefault(); actionFolder(id, "resume"); }
        });
        opts.push({
            text: $.i18n('restart'),
            icon: 'fa-refresh',
            action: (evt) => { evt.preventDefault(); actionFolder(id, "restart"); }
        });
        opts.push({ divider: true });
    }

    if(folderData.status.managed > 0) {
        folderLog(`addDockerFolderContext (id: ${id}): Folder has managed containers. Adding update options.`);
        if(!folderData.status.upToDate) {
            opts.push({
                text: $.i18n('update'),
                icon: 'fa-cloud-download',
                action: (evt) => { evt.preventDefault();  updateFolder(id); }
            });
        } else {
            opts.push({
                text: $.i18n('update-force'),
                icon: 'fa-cloud-download',
                action: (evt) => { evt.preventDefault(); forceUpdateFolder(id); }
            });
        }
        opts.push({ divider: true });
    }

    opts.push({
        text: $.i18n('edit'),
        icon: 'fa-wrench',
        action: (evt) => { evt.preventDefault(); editFolder(id); }
    });

    opts.push({
        text: $.i18n('remove'),
        icon: 'fa-trash',
        action: (evt) => { evt.preventDefault(); rmFolder(id); }
    });

    // Add custom actions as submenu if not overriding and custom actions exist
    if(!folderData.settings.override_default_actions && folderData.actions && folderData.actions.length) {
        folderLog(`addDockerFolderContext (id: ${id}): Adding custom actions as submenu.`);
        opts.push({ divider: true });
        opts.push({
            text: $.i18n('custom-actions'),
            icon: 'fa-bars',
            subMenu: folderData.actions.map((e, i) => {
                return {
                    text: e.name,
                    icon: e.script_icon || "fa-bolt",
                    action: (evt) => { evt.preventDefault(); folderCustomAction(id, i); }
                }
            })
        });
    }

    folderLog(`addDockerFolderContext (id: ${id}): Dispatching docker-folder-context event. Options:`, opts);
    folderEvents.dispatchEvent(new CustomEvent('docker-folder-context', {detail: { id, opts }}));

    context.attach('#' + id, opts);
    folderLog(`addDockerFolderContext (id: ${id}): Context menu attached to #${id}. Exit.`);
};

// Patching the original function to make sure the containers are rendered before insering the folder
window.listview_original = window.listview; // Ensure original is captured
window.listview = () => {
    folderLog('Patched listview: Entry.');
    if (typeof window.listview_original === 'function') {
        window.listview_original();
        folderLog('Patched listview: Called original listview.');
    } else {
        folderWarn('Patched listview: window.listview_original is not a function!');
    }

    if (!loadedFolder) {
        folderLog('Patched listview: loadedFolder is false. Calling createFolders.');
        createFolders(); // This is async, but original listview isn't, so this runs after.
        loadedFolder = true;
         folderLog('Patched listview: Set loadedFolder to true.');
    } else {
        folderLog('Patched listview: loadedFolder is true. Skipped createFolders.');
    }
    folderLog('Patched listview: Exit.');
};

window.loadlist_original = window.loadlist; // Ensure original is captured
window.loadlist = () => {
    folderLog('Patched loadlist: Entry.');
    loadedFolder = false;
    folderLog('Patched loadlist: Set loadedFolder to false.');
    folderReq = [
        // Get the folders
        $.get('/plugins/unraid-folderview/server/read.php?type=docker').promise(),
        // Get the order as unraid sees it
        $.get('/plugins/unraid-folderview/server/read_order.php?type=docker').promise(),
        // Get the info on containers, needed for autostart, update and started
        $.get('/plugins/unraid-folderview/server/read_info.php?type=docker').promise(),
        // Get the order that is shown in the webui
        $.get('/plugins/unraid-folderview/server/read_unraid_order.php?type=docker').promise()
    ];
    folderLog('Patched loadlist: folderReq initialized with 4 promises.');
    if (typeof window.loadlist_original === 'function') {
        window.loadlist_original();
        folderLog('Patched loadlist: Called original loadlist.');
    } else {
        folderWarn('Patched loadlist: window.loadlist_original is not a function!');
    }
     folderLog('Patched loadlist: Exit.');
};

// Get the number of CPU, nneded for a right display of the load
folderLog('Requesting CPU count.');
$.get('/plugins/unraid-folderview/server/cpu.php').promise().then((data) => {
    cpus = parseInt(data);
    folderLog(`CPU count received: ${cpus}. Attaching SSE listener for dockerload.`);
    // Attach to the scoket and process the data
    dockerload.addEventListener('message', (e_sse) => { // Renamed e to e_sse to avoid conflict

        // --- START OF FIX ---
        if (typeof e_sse.data !== 'string' || !e_sse.data.trim()) {
            return; // Skip processing if data is not a string or is empty
        }
        // --- END OF FIX ---

        folderLog('dockerload SSE: Message received (e_sse.data):', e_sse.data);
        let load = {};
        const lines = e_sse.data.split('\n');
        lines.forEach((line_str) => { // Renamed e to line_str
            if (!line_str.trim()) return; // Skip empty lines
            const exp = line_str.split(';');
            if (exp.length >= 3) { // Basic validation
                load[exp[0]] = {
                    cpu: exp[1],
                    mem: exp[2].split(' / ')
                };
            } else {
                folderWarn('dockerload SSE: Malformed line:', line_str);
            }
        });
        folderLog('dockerload SSE: Parsed load data:', {...load});
        for (const [id, value] of Object.entries(globalFolders)) {
            let loadCpu = 0;
            let totalMemB = 0; // Use Bytes for sum then convert
            let loadMemB = 0;  // Use Bytes for sum then convert

            if (!value || !value.containers) {
                folderWarn(`dockerload SSE: Folder ${id} or its containers not found in globalFolders.`);
                continue;
            }

            for (const [cid_name, cvalue] of Object.entries(value.containers)) { // cid_name is container name, cvalue is {id, state, ...}
                const containerShortId = cvalue.id;
                const curLoad = load[containerShortId] || { cpu: '0.00%', mem: ['0B', '0B'] };
                loadCpu += parseFloat(curLoad.cpu.replace('%', '')) / cpus; // Already per core from SSE
                loadMemB += memToB(curLoad.mem[0]);
                let tempTotalMem = memToB(curLoad.mem[1]);
                totalMemB = Math.max(totalMemB, tempTotalMem); // Max of individual limits, or sum if preferred
            }
            folderLog(`dockerload SSE (folder ${id}): Calculated totals - loadCpu: ${loadCpu.toFixed(2)}%, loadMemB: ${loadMemB}, totalMemB: ${totalMemB}`);
            $(`span.mem-folder-${id}`).text(`${bToMem(loadMemB)} / ${bToMem(totalMemB)}`);
            $(`span.cpu-folder-${id}`).text(`${loadCpu.toFixed(2)}%`);
            $(`span#cpu-folder-${id}`).css('width', `${Math.min(100, loadCpu).toFixed(2)}%`); // Cap at 100% for display
        }
    });
}).catch(err => {
    folderWarn('Error fetching CPU count:', err);
});

/**
 * Convert memory unit to Bytes
 * @param {string} mem the unraid memory notation
 * @returns {number} number of bytes
 */
const memToB = (mem) => {
    if (typeof mem !== 'string') {
        folderWarn(`memToB: Input is not a string: ${mem}. Returning 0.`);
        return 0;
    }
    const unitMatch = mem.match(/[a-zA-Z]+/); // Get all letters for unit
    const unit = unitMatch ? unitMatch[0] : 'B'; // Default to B if no letters
    const numPart = parseFloat(mem.replace(unit, ''));

    if (isNaN(numPart)) {
         folderWarn(`memToB: Could not parse number from ${mem}. Returning 0.`);
        return 0;
    }

    let multiplier = 1;
    switch (unit) {
        case 'Bytes': case 'B': multiplier = 1; break; // Added Bytes
        case 'KiB': multiplier = 2 ** 10; break;
        case 'MiB': multiplier = 2 ** 20; break;
        case 'GiB': multiplier = 2 ** 30; break;
        case 'TiB': multiplier = 2 ** 40; break;
        case 'PiB': multiplier = 2 ** 50; break;
        case 'EiB': multiplier = 2 ** 60; break;
        // ZiB and YiB are rare for container mem but kept for completeness
        case 'ZiB': multiplier = 2 ** 70; break;
        case 'YiB': multiplier = 2 ** 80; break;
        default:
            folderWarn(`memToB: Unknown memory unit '${unit}' in '${mem}'. Assuming Bytes.`);
            multiplier = 1; // Default to Bytes if unit is unknown
            break;
    }
    const result = numPart * multiplier;
    return result;
};


/**
 * Convert Bytes to memory units
 * @param {number} b the number of bytes
 * @returns {string} a string with the right notation and right unit
 */
const bToMem = (b) => {
    if (typeof b !== 'number' || isNaN(b) || b < 0) {
        folderWarn(`bToMem: Invalid input ${b}. Returning '0 B'.`);
        return '0 B';
    }
    if (b === 0) return '0 B';

    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let i = 0;
    let value = b;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    const result = `${value.toFixed(2)} ${units[i]}`;
    return result;
};


// Global variables
let cpus = 1;
let loadedFolder = false;
let globalFolders = {};
// folderRegex is a page global supplied by scripts/folder-core.js
let folderDebugMode = false; // Existing flag
let folderDebugModeWindow = [];
let folderobserver;
let folderobserverConfig = {
    subtree: true,
    attributes: true
};
let folderReq = [];

folderLog('Global variables initialized:', {
    cpus, loadedFolder, globalFolders: {...globalFolders}, folderRegex: folderRegex.toString(),
    folderDebugMode, folderDebugModeWindow: [...folderDebugModeWindow],
    folderobserverConfig: {...folderobserverConfig}, folderReq: [...folderReq]
});

// Add the button for creating a folder
const createFolderBtn = () => {
    folderLog('createFolderBtn: Clicked. Redirecting.');
    location.href = "/Docker/Folder?type=docker"
};

// This is needed because unraid don't like the folder and the number are set incorrectly, this intercept the request and change the numbers to make the order appear right, this is important for the autostart and to draw the folders
$.ajaxPrefilter((options, originalOptions, jqXHR) => {
    if (options.url === "/plugins/dynamix.docker.manager/include/UserPrefs.php") {
        folderLog('ajaxPrefilter (UserPrefs.php): Intercepted.', {...options});
        const data = new URLSearchParams(options.data);
        const containers = data.get('names').split(';');
        let num = "";
        for (let index = 0; index < containers.length - 1; index++) {
            num += index + ';'
        }
        data.set('index', num);
        options.data = data.toString();
        folderLog('ajaxPrefilter (UserPrefs.php): Modified options.data:', options.data);
    }
});

// activate debug mode
addEventListener("keydown", (e) => {
    if (e.isComposing || e.key.length !== 1) {
        return;
    }
    folderDebugModeWindow.push(e.key);
    if(folderDebugModeWindow.length > 5) {
        folderDebugModeWindow.shift();
    }
    folderLog(`Keydown event: key='${e.key}'. Debug window: ${folderDebugModeWindow.join('')}`);
    if(folderDebugModeWindow.join('').toLowerCase() === "debug") {
        folderDebugMode = true; // Existing flag
        folderLog('Debug sequence "debug" detected. Set folderDebugMode (existing) to true. Reloading list.');
        loadlist();
    }
});

folderLog('docker.js: End of script execution.');