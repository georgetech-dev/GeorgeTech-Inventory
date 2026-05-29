/* =========================================================
   GLOBAL STATE & UTILITIES
========================================================= */
let isImportingSyncLock = false;
let currentItemForActions = null;
let currentLocationId = null;
let locationHistory = [];
let locationsAdmin = [];
let tempLocationsAdmin = []; 
let adminLocationView = "hierarchy";
let editingLocationId = null;
let editingTempLocationId = null;
let currentLocationAdmin = null;
let currentTempLocationId = null; 

let globalCachedTags = [];
let globalCachedCategories = [];
let activeSelectedAddTags = [];
let activeSelectedEditTags = [];

let editingTagTargetId = null;
let editingCategoryTargetId = null;
let isSubModalContextCall = false;

let currentBrowserLocations = [];
let currentBrowserItems = [];

let currentAddItemFiles = [];
let currentEditItemFiles = []; 
let existingItemPhotosToDelete = []; 
let primaryPhotoIdentifier = null; 

let currentAddLocationFiles = [];
let currentEditLocationFile = null;

let lightboxImages = []; 
let lightboxIndex = 0;   
let lastMovedItemId = null;
let currentSortMode = "name_asc";
let currentSortModeLocations = "name_asc";
let itemsBrowserMode = "hierarchy";

let currentUserEmail = "Unknown User";
let allAuditLogs = [];

let userSettings = {
    view: 'medium',
    locationsView: 'medium',
    columns: { name: true, quantity: true, barcode: true, nfc: true, category: true, tags: true },
    widths: { name: '25%', quantity: '10%', barcode: '15%', nfc: '15%', category: '15%', tags: '20%' },
    defaultCameraId: 'AUTO_REAR',
    defaultZoom: 1.5
};

function buildLocationPath(id) {
    if (!id || !locationsAdmin || locationsAdmin.length === 0) return "";
    let loc = locationsAdmin.find(l => l.id === id);
    if (!loc) return "";
    const parts = [loc.name];
    while (loc.parent) {
        loc = locationsAdmin.find(l => l.id === loc.parent);
        if (!loc) break;
        parts.unshift(loc.name);
    }
    return parts.join(" > ");
}

function clearSearch() {
    document.getElementById('globalSearchInput').value = '';
    handleGlobalSearch('');
}

function normaliseToken(value) {
    return String(value || "").trim().toLowerCase();
}

function locationMatchesToken(location, token) {
    const clean = normaliseToken(token);
    if (!location || !clean) return false;
    return normaliseToken(location.barcode) === clean
        || normaliseToken(location.nfc_tag) === clean
        || normaliseToken(location.nfc) === clean
        || normaliseToken(location.name) === clean;
}

function itemMatchesHardwareToken(item, token) {
    const clean = normaliseToken(token);
    if (!item || !clean) return false;
    return normaliseToken(item.barcode) === clean || normaliseToken(item.nfc_tag) === clean;
}

function findLocationByScanToken(token) {
    return (locationsAdmin || []).find(location => locationMatchesToken(location, token));
}

function findItemByScanToken(items, token) {
    return (items || []).find(item => itemMatchesHardwareToken(item, token));
}

function resetSearchControlsAfterScan() {
    const typeFilter = document.getElementById("searchTypeFilter");
    const searchInput = document.getElementById("globalSearchInput");
    if (typeFilter) typeFilter.value = "all";
    if (searchInput) searchInput.value = "";
    activeSearchEmptyTerm = "";
    activeSearchTags = [];
    activeSearchCategory = null;
    const pillsRow = document.getElementById("searchFilterPillsRow");
    if (pillsRow) {
        pillsRow.style.display = "none";
        pillsRow.innerHTML = "";
    }
}

async function routeGlobalHardwareScan(scannedToken) {
    const cleanToken = String(scannedToken || "").trim();
    if (!cleanToken) return;

    const locationMatch = findLocationByScanToken(cleanToken);
    if (locationMatch) {
        resetSearchControlsAfterScan();
        showPage("pageItems");
        navigateToLocation(locationMatch.id);
        return;
    }

    const items = await localDB.items.toArray();
    const itemMatch = findItemByScanToken(items, cleanToken);
    if (itemMatch) {
        resetSearchControlsAfterScan();
        showPage("pageItems");
        currentLocationId = itemMatch.location_id || null;
        if (currentLocationId) await loadLocation(currentLocationId);
        else await loadRootLocations();
        openItemDetails(itemMatch);
        return;
    }

    resetSearchControlsAfterScan();
    await customAlert("No item or location found matching that barcode/NFC tag.", "Scan Not Found");
}

function getNfcTextFromEvent(event) {
    try {
        const decoder = new TextDecoder();
        for (const record of event.message?.records || []) {
            if (record.data) {
                const data = record.data instanceof DataView
                    ? new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
                    : new Uint8Array(record.data);
                let text = "";
                if (record.recordType === "text" && data.length > 0) {
                    const languageCodeLength = data[0] & 0x3f;
                    text = decoder.decode(data.slice(1 + languageCodeLength)).trim();
                } else {
                    text = decoder.decode(data).replace(/^\w{2}/, "").trim();
                }
                if (text) return text;
            }
        }
    } catch (e) {}
    return event.serialNumber || "";
}

let activeSearchEmptyTerm = "";

function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[ch]));
}

let modalDirtySnapshots = {};
let pendingLocationPickerAfterCreate = null;

function getModalDirtySnapshot(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return "";
    const values = {};
    modal.querySelectorAll("input, textarea, select").forEach(el => {
        if (!el.id) return;
        if (el.type === "file") values[el.id] = Array.from(el.files || []).map(file => file.name);
        else if (el.type === "checkbox" || el.type === "radio") values[el.id] = el.checked;
        else values[el.id] = el.value;
    });
    if (modalId === "itemEditModal") {
        values.__barcode = editModalActiveBarcodeString || "";
        values.__nfc = editModalActiveNfcTagString || "";
        values.__tags = [...activeSelectedEditTags].sort();
        values.__newFiles = currentEditItemFiles.map(file => file.name);
        values.__deletedPhotos = [...existingItemPhotosToDelete].sort();
        values.__primaryPhoto = primaryPhotoIdentifier || "";
    }
    if (modalId === "addItemModal") {
        values.__tags = [...activeSelectedAddTags].sort();
        values.__newFiles = currentAddItemFiles.map(file => file.name);
        values.__primaryPhoto = primaryPhotoIdentifier || "";
    }
    if (modalId === "locationActionsModal" || modalId === "addLocationModal") {
        values.__photoChanged = !!currentEditLocationFile || !!window.locationPhotoDeleted || currentAddLocationFiles.length > 0;
    }
    return JSON.stringify(values);
}

function markModalClean(modalId) {
    modalDirtySnapshots[modalId] = getModalDirtySnapshot(modalId);
    resetModalScroll(modalId);
}

function isModalDirty(modalId) {
    return modalDirtySnapshots[modalId] !== undefined && modalDirtySnapshots[modalId] !== getModalDirtySnapshot(modalId);
}

function closeModalClean(modalId) {
    delete modalDirtySnapshots[modalId];
    closeModal(modalId);
}

async function closeModalWithDirtyCheck(modalId) {
    if (!isModalDirty(modalId) || await customConfirm("Are you sure? Any unsaved changes will be lost.", "Discard Changes?", true)) {
        closeModalClean(modalId);
    }
}

function resetModalScroll(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.scrollTop = 0;
    modal.querySelectorAll(".modal-content").forEach(content => { content.scrollTop = 0; });
}

function showNoChangesDialog(modalId, entityLabel = "item") {
    return new Promise(resolve => {
        document.getElementById("dialogTitle").textContent = "No Changes";
        document.getElementById("dialogMessage").innerHTML = `There are no ${entityLabel} changes to save.`;
        const buttons = document.getElementById("dialogButtons");
        buttons.innerHTML = `
            <button class="btn-outline" id="noChangesReturnBtn" style="min-width: 130px;">Return & Edit</button>
            <button class="btn-primary" id="noChangesLeaveBtn" style="min-width: 150px;">Leave Without Saving</button>
        `;
        document.getElementById("customDialogModal").style.display = "flex";
        document.getElementById("noChangesReturnBtn").onclick = () => {
            document.getElementById("customDialogModal").style.display = "none";
            resolve(false);
        };
        document.getElementById("noChangesLeaveBtn").onclick = () => {
            document.getElementById("customDialogModal").style.display = "none";
            closeModalClean(modalId);
            resolve(true);
        };
    });
}

function openAddLocationFromItemModal(selectId) {
    pendingLocationPickerAfterCreate = selectId;
    openAddLocationModal();
    const modal = document.getElementById("addLocationModal");
    if (modal) {
        modal.classList.add("modal-on-top-of-item-form");
        modal.style.zIndex = "15050";
    }
}

function ensureItemModalCloseButton(modalId, titleSelector, cancelTargetId) {
    const title = document.querySelector(`#${modalId} ${titleSelector}`);
    if (!title || title.querySelector(".item-form-close-x")) return;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "item-form-close-x";
    closeBtn.textContent = "×";
    closeBtn.onclick = () => confirmCancel(cancelTargetId || modalId);
    title.appendChild(closeBtn);
}

function stackItemFormActions(actionStack, orderedButtons) {
    if (!actionStack) return;
    actionStack.className = "item-form-bottom-actions";
    orderedButtons.filter(Boolean).forEach(button => {
        button.classList.add("item-form-bottom-button");
        actionStack.appendChild(button);
    });
}

function createToolToggleButton(id, isActive, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "item-form-tool-toggle";
    initialiseToolToggle(button);
    button.onclick = onClick;
    button.setAttribute("aria-label", "Toggle item tool mode");
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.dataset.active = isActive ? "true" : "false";
    setToolToggleVisual(button, isActive);
    return button;
}

function initialiseToolToggle(button) {
    if (!button) return;
    button.innerHTML = `
        <span class="item-form-tool-toggle-thumb" aria-hidden="true"></span>
        <span class="item-form-tool-toggle-option">Equipment</span>
        <span class="item-form-tool-toggle-option">Tool</span>
    `;
}

function setToolToggleVisual(button, isActive) {
    if (!button) return;
    if (!button.querySelector(".item-form-tool-toggle-option")) initialiseToolToggle(button);
    button.dataset.active = isActive ? "true" : "false";
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.classList.toggle("active", !!isActive);
}

function setNumberControlDisabledState(wrapper, input, isDisabled, disabledValue, fallbackValue) {
    if (wrapper) {
        wrapper.style.opacity = isDisabled ? "0.68" : "1";
        wrapper.style.filter = isDisabled ? "grayscale(100%)" : "none";
        wrapper.style.pointerEvents = "auto";
        wrapper.classList.toggle("disabled", !!isDisabled);
        wrapper.querySelectorAll("button").forEach(button => {
            button.disabled = !!isDisabled;
            button.classList.toggle("disabled", !!isDisabled);
        });
    }
    if (input) {
        if (isDisabled) {
            input.value = disabledValue;
        } else if (input.value === disabledValue || input.value === "") {
            input.value = fallbackValue;
        }
        input.disabled = !!isDisabled;
        input.style.background = isDisabled ? "#e2e8f0" : "#ffffff";
    }
}

function normaliseMinimumOrderValue(value) {
    const clean = String(value ?? "").trim();
    if (!clean || clean === "-") return "-";
    const parsed = parseInt(clean, 10);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "-";
}

function adjustMinimumOrderQty(mode, amount) {
    const input = document.getElementById(mode === "edit" ? "editItemMinimumOrder" : "addItemMinimumOrder");
    if (!input) return;
    const current = normaliseMinimumOrderValue(input.value);
    let next = current === "-" ? 0 : parseInt(current, 10);
    next += amount;
    input.value = next > 0 ? String(next) : "-";
}

function sanitiseMinimumOrderInput(input) {
    if (input) input.value = normaliseMinimumOrderValue(input.value);
}

function ensureMinimumOrderControl(mode) {
    const id = mode === "edit" ? "editItemMinimumOrder" : "addItemMinimumOrder";
    let wrapper = document.getElementById(`${id}Wrapper`);
    if (wrapper) return wrapper;

    wrapper = document.createElement("div");
    wrapper.id = `${id}Wrapper`;
    wrapper.className = "item-form-minimum-wrapper";

    const label = makeItemFormLabel("Minimum reorder");
    const control = document.createElement("div");
    control.className = "item-form-number-control";

    const input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.value = "-";
    input.inputMode = "numeric";
    input.oninput = () => {
        input.value = input.value.replace(/[^\d-]/g, "");
        if (input.value.includes("-") && input.value !== "-") input.value = input.value.replace(/-/g, "");
    };
    input.onblur = () => sanitiseMinimumOrderInput(input);

    const stepper = document.createElement("div");
    stepper.className = "item-form-stepper";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "btn-secondary";
    up.textContent = "▲";
    up.onclick = () => adjustMinimumOrderQty(mode, 1);

    const down = document.createElement("button");
    down.type = "button";
    down.className = "btn-secondary";
    down.textContent = "▼";
    down.onclick = () => adjustMinimumOrderQty(mode, -1);

    stepper.append(up, down);
    control.append(input, stepper);
    wrapper.append(label, control);
    return wrapper;
}

/* =========================================================
   CUSTOM BRANDED DIALOG ENGINE & UTILS
========================================================= */
function customAlert(message, title = "Notice") {
    return new Promise((resolve) => {
        document.getElementById("dialogTitle").textContent = title;
        // CHANGE THIS LINE to use innerHTML instead of textContent
        document.getElementById("dialogMessage").innerHTML = message; 
        
        const btnContainer = document.getElementById("dialogButtons");
        btnContainer.innerHTML = `<button class="btn-primary" id="dialogOkBtn" style="min-width: 120px;">OK</button>`;
        document.getElementById("customDialogModal").style.display = "flex";
        document.getElementById("dialogOkBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve(); };
    });
}

function customConfirm(message, title = "Confirm Action", isDanger = false) {
    return new Promise((resolve) => {
        document.getElementById("dialogTitle").textContent = title;
        document.getElementById("dialogMessage").textContent = message;
        const btnColor = isDanger ? "background: #ef4444; border-color: #ef4444;" : "";
        const btnContainer = document.getElementById("dialogButtons");
        btnContainer.innerHTML = `<button class="btn-outline" id="dialogCancelBtn" style="min-width: 100px;">Cancel</button><button class="btn-primary" id="dialogConfirmBtn" style="${btnColor} min-width: 100px;">Confirm</button>`;
        document.getElementById("customDialogModal").style.display = "flex";
        document.getElementById("dialogCancelBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve(false); };
        document.getElementById("dialogConfirmBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve(true); };
    });
}

function closeModal(id) {
    document.getElementById(id).style.display = "none";
    delete modalDirtySnapshots[id];
    if (id === "addLocationModal") {
        pendingLocationPickerAfterCreate = null;
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove("modal-on-top-of-item-form");
            modal.style.zIndex = "";
        }
    }
}
async function confirmCancel(modalId) { await closeModalWithDirtyCheck(modalId); }
async function withStatus(fn, label) { window.setStatus("syncing", label); try { const r = await fn(); window.setStatus("connected", "Connected"); return r; } catch (e) { window.setStatus("error", "Error"); throw e; } }

/* =========================================================
    AUDIT LOGGING ENGINE
========================================================= */
async function logAction(actionType, targetEntity, targetName, details = "") {
    if (!window.isAppOnline) return; // Skip audit logs if offline for now
    try {
        await window.db.from("audit_logs").insert([{ user_email: currentUserEmail, action_type: actionType, target_entity: targetEntity, target_name: targetName, details: details }]);
    } catch(e) { console.error("Audit log failed:", e); }
}
// Mapping emails to shorthand
const userMap = {
    "steph@warmright.com": "Steph",
    "admin@warmright.com": "Admin",
    // Add more here as needed
};

// --- AUDIT LOG ENGINE ---
async function loadAuditLogs() {
    try {
        const logs = await localDB.audit_logs.toArray();
        // Sort newest-first
        allAuditLogs = logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        filterAuditLogs();
        console.log("Logs loaded:", allAuditLogs.length);
    } catch (e) {
        console.error("Audit log failed to load:", e);
    }
}

function filterAuditLogs() {
    const actionFilter = document.getElementById("logActionFilter")?.value || "ALL";
    const dateFilter = document.getElementById("logDateFilter")?.value || "FOREVER";
    const searchTerm = (document.getElementById("logSearchInput")?.value || "").toLowerCase();
    const tbody = document.getElementById("auditLogTableBody"); 
    if (!tbody) return; 
    tbody.innerHTML = "";

    const now = new Date();
    const filtered = allAuditLogs.filter(log => {
        const logDate = new Date(log.created_at);
        let matchDate = true;
        
        if (dateFilter === "TODAY") matchDate = logDate.toDateString() === now.toDateString();
        else if (dateFilter === "7DAYS") matchDate = (now - logDate) < (7 * 24 * 60 * 60 * 1000);
        else if (dateFilter === "MONTH") matchDate = (now - logDate) < (30 * 24 * 60 * 60 * 1000);
        else if (dateFilter === "YEAR") matchDate = logDate.getFullYear() === now.getFullYear();

        const matchAction = actionFilter === "ALL" || log.action_type === actionFilter;
        const matchSearch = (log.target_name || "").toLowerCase().includes(searchTerm) || 
                            (log.user_email || "").toLowerCase().includes(searchTerm) || 
                            (log.details || "").toLowerCase().includes(searchTerm);
        
        return matchDate && matchAction && matchSearch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #999; padding: 20px;">No logs match your criteria.</td></tr>`;
        return;
    }

    filtered.forEach(log => {
        const date = new Date(log.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
        const shortName = userMap[log.user_email] || log.user_email.split('@')[0];
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="col-date">${date}</td>
            <td class="col-user" style="font-weight:600;">${shortName}</td>
            <td class="col-action"><span class="badge">${log.action_type}</span></td>
            <td class="col-entity">${log.target_entity}</td>
            <td class="col-details"><b>${log.target_name}</b> ${log.details}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Re-apply column visibility settings after re-rendering
    applyColumnSettings();
}

/* =========================================================
    DATA BACKUP & EXPORT UTILITIES (OFFLINE SAFE)
========================================================= */
function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

async function exportFullBackup() {
    if (!(await customConfirm("This will download a full snapshot of your system database. Continue?", "System Backup"))) return;
    window.setStatus("syncing", "Preparing Backup...");
    try {
        const backupData = {
            timestamp: new Date().toISOString(), version: "1.1",
            tables: { 
                items: await localDB.items.toArray(), locations: await localDB.locations.toArray(), 
                temp_locations: await localDB.temp_locations.toArray(), tags: await localDB.tags.toArray(), 
                categories: await localDB.item_categories.toArray(), audit_logs: [] 
            }
        };
        const fileName = `warm_inventory_backup_${new Date().toISOString().split('T')[0]}.json`;
        downloadFile(fileName, JSON.stringify(backupData, null, 2), "application/json");
        logAction("CREATE", "System", "Full Backup", "Exported JSON snapshot");
        window.setStatus("connected", "Backup Complete");
    } catch(e) { window.setStatus("error", "Backup Failed"); await customAlert("System encountered an error.", "System Error"); }
}

async function exportItemsCSV() {
    window.setStatus("syncing", "Generating CSV...");
    const items = await localDB.items.toArray();
    let csvContent = "Name,Quantity,Location Path,Assigned To (Temp Loc),Barcode,NFC,Category,Tags\n";
    items.forEach(item => {
        const locPath = item.location_id ? buildLocationPath(item.location_id) : 'Unallocated';
        const tempLoc = tempLocationsAdmin.find(t => t.id === item.assigned_to);
        const assignedTo = tempLoc ? tempLoc.name : '';
        const tags = Array.isArray(item.tags) ? item.tags.join("; ") : (item.tags || "");
        const row = [ `"${(item.name || '').replace(/"/g, '""')}"`, item.quantity || 0, `"${locPath.replace(/"/g, '""')}"`, `"${assignedTo.replace(/"/g, '""')}"`, `"${(item.barcode || '').replace(/"/g, '""')}"`, `"${(item.nfc_tag || '').replace(/"/g, '""')}"`, `"${(item.category || '').replace(/"/g, '""')}"`, `"${tags.replace(/"/g, '""')}"` ];
        csvContent += row.join(",") + "\n";
    });
    downloadFile(`warm_items_export_${new Date().getTime()}.csv`, csvContent, "text/csv");
    logAction("CREATE", "System", "Items CSV", "Exported Items to Spreadsheet");
    window.setStatus("connected", "Items Exported");
}

async function exportLocationsCSV() {
    window.setStatus("syncing", "Generating CSV...");
    let csvContent = "Folder Name,Full Path,Barcode,NFC,Category\n";
    locationsAdmin.forEach(loc => {
        const row = [ `"${(loc.name || '').replace(/"/g, '""')}"`, `"${buildLocationPath(loc.id).replace(/"/g, '""')}"`, `"${(loc.barcode || '').replace(/"/g, '""')}"`, `"${(loc.nfc || '').replace(/"/g, '""')}"`, `"${(loc.category || '').replace(/"/g, '""')}"` ];
        csvContent += row.join(",") + "\n";
    });
    downloadFile(`warm_locations_export_${new Date().getTime()}.csv`, csvContent, "text/csv");
    logAction("CREATE", "System", "Locations CSV", "Exported Locations");
    window.setStatus("connected", "Locations Exported");
}

async function exportItemsPDF() {
    if (!window.jspdf) return await customAlert("Report generator is currently loading...", "Loading Engine");
    window.setStatus("syncing", "Formatting PDF...");
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(0, 74, 153); doc.text("Warm Right Ltd - Inventory Report", 14, 22);
    doc.setFontSize(10); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleString()} by ${currentUserEmail}`, 14, 30);

    const items = await localDB.items.toArray();
    const tableData = items.map(item => {
        const locPath = item.location_id ? buildLocationPath(item.location_id) : 'Unallocated';
        const tempLoc = tempLocationsAdmin.find(t => t.id === item.assigned_to);
        return [ item.name || 'Unknown', (item.quantity || 0).toString(), locPath, tempLoc ? `Out: ${tempLoc.name}` : 'In Stock', item.category || '-' ];
    });

    doc.autoTable({ startY: 38, head: [['Item Name', 'Qty', 'Storage Location', 'Current Status', 'Category']], body: tableData, theme: 'striped', headStyles: { fillColor: [0, 74, 153], textColor: [255, 255, 255] }, styles: { fontSize: 9 }, columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 15 }, 2: { cellWidth: 50 }, 3: { cellWidth: 40 }, 4: { cellWidth: 30 } } });
    doc.save(`warm_stock_report_${new Date().getTime()}.pdf`);
    logAction("CREATE", "System", "PDF Stock Report", "Exported PDF");
    window.setStatus("connected", "PDF Generated");
}

async function exportFullSystemZip() {
    if (!window.JSZip) return await customAlert("ZIP Engine is currently loading. Please wait a moment...", "Loading Engine");
    
    if (!(await customConfirm("Generate a fully self-contained offline archive? This may take a moment to download all images.", "Master Archive"))) return;

    window.setStatus("syncing", "Assembling Master Archive...");

    try {
        const zip = new JSZip();
        const imgFolder = zip.folder("images");

        // 1. Gather all data from the local Dexie DB
        let exportItems = JSON.parse(JSON.stringify(await localDB.items.toArray()));
        let exportLocs = JSON.parse(JSON.stringify(await localDB.locations.toArray()));
        let exportTemps = JSON.parse(JSON.stringify(await localDB.temp_locations.toArray()));
        const tags = await localDB.tags.toArray();
        const categories = await localDB.item_categories.toArray();

        // 2. Download Images to the Archive
        if (window.isAppOnline) {
            window.setStatus("syncing", "Downloading images to archive...");

            async function fetchAndZipImage(bucket, fileName) {
                if (!fileName) return null;
                try {
                    const { data, error } = await window.db.storage.from(bucket).download(fileName);
                    if (data) {
                        imgFolder.file(fileName, data);
                        return `./images/${fileName}`; 
                    }
                } catch (e) { console.warn("Failed to download image:", fileName); }
                return null;
            }

            for (let item of exportItems) {
                if (item.photos && Array.isArray(item.photos)) {
                    for (let photo of item.photos) {
                        const localPath = await fetchAndZipImage("item-photos", photo.file_path);
                        if (localPath) photo.file_path = localPath;
                    }
                }
            }

            for (let loc of exportLocs) {
                if (loc.photo_path) {
                    const localPath = await fetchAndZipImage("location-photos", loc.photo_path);
                    if (localPath) loc.photo_path = localPath;
                }
            }

            for (let temp of exportTemps) {
                if (temp.photo_path) {
                    const localPath = await fetchAndZipImage("location-photos", temp.photo_path);
                    if (localPath) temp.photo_path = localPath;
                }
            }
        } else {
            await customAlert("You are currently offline. The archive will be generated with data only (no images).", "Offline Notice");
        }

        // 3. Assemble and save the data files
        const backupData = {
            timestamp: new Date().toISOString(),
            items: exportItems,
            locations: exportLocs,
            temp_locations: exportTemps,
            tags: tags,
            categories: categories
        };
        
        zip.file("inventory.json", JSON.stringify(backupData, null, 2));
        zip.file("data.js", `const WARM_RIGHT_DATA = ${JSON.stringify(backupData)};`);

        // 4. Inject the Viewer HTML (Standard backticks, fixed HTML syntax)
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline Inventory Viewer</title>
    <style>
        :root { --primary: #004a99; --accent: #10b981; --bg: #f8fafc; --card-bg: #ffffff; --text: #334155; }
        body { font-family: 'Segoe UI', -apple-system, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
        .header { background: var(--card-bg); padding: 20px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 20px; text-align: center; }
        .file-upload { display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-top: 10px; transition: opacity 0.2s; font-size: 13px; }
        .file-upload:hover { opacity: 0.9; }
        input[type="file"] { display: none; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; flex-wrap: wrap; }
        .tab { padding: 10px 20px; background: var(--card-bg); border: 2px solid transparent; border-radius: 8px; cursor: pointer; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .tab.active { border-color: var(--primary); color: var(--primary); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
        .card { background: var(--card-bg); border-radius: 12px; padding: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: space-between; min-height: 260px; box-sizing: border-box; }
        .image-container { position: relative; width: 100%; height: 150px; background: #f1f5f9; border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
        .card-img { width: 100%; height: 100%; object-fit: cover; }
        .no-image-box { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #94a3b8; font-weight: bold; font-size: 14px; text-align: center; padding: 10px; box-sizing: border-box;}
        .card h3 { margin: 0 0 5px 0; font-size: 16px; color: var(--primary); text-align: center; }
        .card p { margin: 0; font-size: 13px; color: #64748b; text-align: center; }
        .badge { display: inline-block; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin: 10px 4px 0 4px; }
        .multi-icon { position: absolute; bottom: 8px; right: 8px; background: rgba(0, 0, 0, 0.65); color: white; padding: 5px 6px 3px 6px; border-radius: 6px; pointer-events: none; backdrop-filter: blur(2px); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #64748b; }
        .footer a { color: var(--primary); text-decoration: none; font-weight: bold; }
        .footer a:hover { text-decoration: underline; }
        .zip-blocker-screen { display: none; max-width: 500px; margin: 100px auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; border: 2px solid #ef4444; }
    </style>
</head>
<body>

    <div id="zipBlocker" class="zip-blocker-screen">
        <span style="font-size: 50px;">📁</span>
        <h2 style="color: #dc2626; margin-top: 15px;">Please extract the folder first!</h2>
        <p style="color: #4b5563; line-height: 1.6; font-size: 15px;">You are currently viewing this file from inside the compressed zip archive container. The application cannot load local resource directories until it is expanded.</p>
        <p style="font-weight: bold; margin-top: 20px; color: #1f2937;">Close this window, right-click the ZIP archive file, choose "Extract All", then reload this browser file from the extracted folder.</p>
    </div>

    <div id="mainViewerContent">
        <div class="header">
            <h1 style="margin: 0 0 5px 0;">📦 Offline Inventory Browser</h1>
            <p id="statusMsg" style="margin: 0 0 15px 0; color: #64748b;">Attempting to auto-load local archive data...</p>
            <label class="file-upload" id="fallbackUpload" style="display:none;"><input type="file" id="jsonLoader" accept=".json">📂 Load alternative inventory.json</label>
        </div>

        <div id="contentArea" style="display:none;">
            <div class="tabs">
                <div class="tab active" onclick="switchTab('items')">📝 Items (<span id="itemCount">0</span>)</div>
                <div class="tab" onclick="switchTab('locations')">📦 Locations (<span id="locCount">0</span>)</div>
                <div class="tab" onclick="switchTab('assignees')">👤 Assignees (<span id="assigneeCount">0</span>)</div>
                <div class="tab" onclick="switchTab('tags')">🏷️ Tags (<span id="tagCount">0</span>)</div>
                <div class="tab" onclick="switchTab('categories')">📁 Categories (<span id="catCount">0</span>)</div>
            </div>
            <div id="itemsGrid" class="grid"></div>
            <div id="locationsGrid" class="grid" style="display: none;"></div>
            <div id="assigneesGrid" class="grid" style="display: none;"></div>
            <div id="tagsGrid" class="grid" style="display: none;"></div>
            <div id="categoriesGrid" class="grid" style="display: none;"></div>
        </div>

        <div class="footer">
            Created by s-george-dev (Stephan George) | 
            <a href="https://github.com/s-george-dev" target="_blank">GitHub</a> | 
            <a href="https://www.linkedin.com/in/steph-v-george/" target="_blank">LinkedIn</a>
        </div>
    </div>

    <script src="data.js"><\/script>

    <script>
        let db = typeof WARM_RIGHT_DATA !== 'undefined' ? WARM_RIGHT_DATA : null;

        // Image error handler replaces broken/missing images with a clean placeholder box
        function handleImageError(imgEl) {
            imgEl.outerHTML = "<div class='no-image-box'>No Image Available</div>";
        }

        (function checkArchiveEnvironment() {
            const url = window.location.href.toLowerCase();
            const isZipProtocol = url.indexOf('zip://') > -1 || url.indexOf('.zip/') > -1;
            const isTempPath = url.indexOf('/appdata/local/temp/') > -1 || url.indexOf('/var/folders/') > -1 || url.indexOf('/tmp/') > -1;
            
            if (isZipProtocol || isTempPath) {
                document.getElementById('mainViewerContent').style.display = 'none';
                document.getElementById('zipBlocker').style.display = 'block';
            }
        })();

        window.onload = function() {
            if(document.getElementById('zipBlocker').style.display === 'block') return;

            if (db && db.items) {
                document.getElementById('statusMsg').innerText = "Data loaded successfully from local archive.";
                document.getElementById('statusMsg').style.color = "#10b981";
                renderAll();
                document.getElementById('contentArea').style.display = 'block';
            } else {
                document.getElementById('statusMsg').innerText = "Notice: data.js file not found. Please upload your inventory.json manually.";
                document.getElementById('fallbackUpload').style.display = 'inline-block';
            }
        };

        // Fallback uploader
        document.getElementById('jsonLoader').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                try {
                    db = JSON.parse(event.target.result);
                    renderAll();
                    document.getElementById('statusMsg').innerText = "Viewing imported collection file: " + file.name;
                    document.getElementById('statusMsg').style.color = "#475569";
                    document.getElementById('contentArea').style.display = 'block';
                } catch (err) { alert("Error parsing JSON file."); }
            };
            reader.readAsText(file);
        });

        function renderAll() {
            document.getElementById('itemCount').innerText = db.items?.length || 0;
            document.getElementById('locCount').innerText = db.locations?.length || 0;
            document.getElementById('assigneeCount').innerText = db.temp_locations?.length || 0;
            document.getElementById('tagCount').innerText = db.tags?.length || 0;
            document.getElementById('catCount').innerText = db.categories?.length || 0;

            // Render Items
            document.getElementById('itemsGrid').innerHTML = (db.items || []).map(function(item) {
                let validPhotos = [];
                if (item.photos && Array.isArray(item.photos)) {
                    validPhotos = item.photos.map(function(p) { return p ? (p.file_path || (typeof p === 'string' ? p : '')) : ''; }).filter(function(p) { return p !== ''; });
                }
                
                let imageHtml = "<div class='no-image-box'>No Image Available</div>";
                let multiBadge = "";
                
                if (validPhotos.length > 0) {
                    if (validPhotos.length > 1) {
                        let safeArr = JSON.stringify(validPhotos).replace(/'/g, "&#39;");
                        multiBadge = "<div class='multi-icon'><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='14' height='14' rx='2' ry='2'></rect><path d='M21 7v14a2 2 0 0 1-2 2H7'></path></svg></div>";
                        imageHtml = "<img class='card-img' src='" + validPhotos[0] + "' onerror='handleImageError(this)' data-photos='" + safeArr + "' data-index='0' onclick='cycleImage(this)' style='cursor: pointer;'>";
                    } else {
                        imageHtml = "<img class='card-img' src='" + validPhotos[0] + "' onerror='handleImageError(this)'>";
                    }
                }
                
                // Categories and Tags Badges
                let catBadge = item.category ? "<div class='badge' style='background:#e0f2fe; color:#0369a1;'>" + item.category + "</div>" : "";
                let tagsHtml = "";
                let tagArr = Array.isArray(item.tags) ? item.tags : (typeof item.tags === 'string' && item.tags.trim() ? item.tags.split(',') : []);
                if(tagArr.length > 0) {
                    tagsHtml = "<div style='margin-top:5px;'>" + tagArr.map(t => "<span class='badge' style='font-weight:normal;'>" + t.trim() + "</span>").join('') + "</div>";
                }

                return "<div class='card'>" +
                    "<div>" +
                        "<div class='image-container'>" + imageHtml + multiBadge + "</div>" +
                        "<h3>" + (item.name || 'Unnamed Item') + "</h3>" +
                        "<p>Barcode: " + (item.barcode || 'N/A') + "</p>" +
                        "<div>" + catBadge + tagsHtml + "</div>" +
                    "</div>" +
                    "<div class='badge' style='background:#f1f5f9;'>Qty: " + (item.quantity || 0) + "</div>" +
                "</div>";
            }).join('');

            // Render Locations
            document.getElementById('locationsGrid').innerHTML = (db.locations || []).map(function(loc) {
                let imageHtml = loc.photo_path ? "<img class='card-img' src='" + loc.photo_path + "' onerror='handleImageError(this)'>" : "<div class='no-image-box'>No Image Available</div>";
                let catBadge = loc.category ? "<div class='badge' style='background:#e0f2fe; color:#0369a1;'>" + loc.category + "</div>" : "";
                    
                return "<div class='card'>" +
                    "<div>" +
                        "<div class='image-container'>" + imageHtml + "</div>" +
                        "<h3 style='color: #10b981;'>" + (loc.name || 'Unnamed Location') + "</h3>" +
                        "<div>" + catBadge + "</div>" +
                    "</div>" +
                    "<p>" + (loc.location_description || 'Folder') + "</p>" +
                "</div>";
            }).join('');

            // Render Assignees
            document.getElementById('assigneesGrid').innerHTML = (db.temp_locations || []).map(function(assign) {
                let imageHtml = assign.photo_path ? "<img class='card-img' src='" + assign.photo_path + "' onerror='handleImageError(this)'>" : "<div class='no-image-box'>No Image Available</div>";
                    
                return "<div class='card'>" +
                    "<div>" +
                        "<div class='image-container'>" + imageHtml + "</div>" +
                        "<h3 style='color: #ff8c00;'>" + (assign.name || 'Unnamed') + "</h3>" +
                    "</div>" +
                    "<p>" + (assign.description || 'Assignee') + "</p>" +
                "</div>";
            }).join('');
            
            // Render Tags
            document.getElementById('tagsGrid').innerHTML = (db.tags || []).map(function(tag) {
                return "<div class='card' style='min-height:auto; justify-content:center;'><h3 style='margin:0;'>🏷️ " + tag.name + "</h3></div>";
            }).join('');

            // Render Categories
            document.getElementById('categoriesGrid').innerHTML = (db.categories || []).map(function(cat) {
                return "<div class='card' style='min-height:auto; justify-content:center;'><h3 style='margin:0; color:#ff8c00;'>📁 " + cat.name + "</h3></div>";
            }).join('');
        }

        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.grid').forEach(function(g) { g.style.display = 'none'; });
            event.target.classList.add('active');
            
            document.getElementById(tabName + 'Grid').style.display = 'grid';
        }

        function cycleImage(imgEl) {
            try {
                let photos = JSON.parse(imgEl.getAttribute('data-photos').replace(/&#39;/g, "'"));
                let currentIndex = parseInt(imgEl.getAttribute('data-index'));
                let nextIndex = (currentIndex + 1) % photos.length;
                imgEl.src = photos[nextIndex];
                imgEl.setAttribute('data-index', nextIndex);
            } catch (e) {}
        }
    <\/script>
</body>
</html>`;

        zip.file("viewer.html", htmlContent);

        // 5. Generate and Download
        window.setStatus("syncing", "Compressing Archive...");
        const content = await zip.generateAsync({ type: "blob" });
        
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = `WarmRight_Master_Archive_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        logAction("CREATE", "System", "ZIP Archive", "Exported Offline Viewer");
        window.setStatus("connected", "Archive Downloaded");

    } catch (error) {
        console.error("ZIP Generation Failed:", error);
        window.setStatus("error", "ZIP Failed");
        await customAlert("Failed to generate the ZIP archive. Please check the console.", "Export Error");
    }
}
/* =========================================================
    GLOBAL BARCODE/NFC UNIQUENESS VALIDATOR (OFFLINE SAFE)
========================================================= */
async function isHardwareTagUnique(token, currentEntityId = null) {
    if (!token || !token.trim()) return true; 
    const cleanToken = token.trim().toLowerCase();
    
    // Check local Dexie DB for speed and offline capabilities
    const locs = await localDB.locations.toArray();
    if (locs.find(l => l.id !== currentEntityId && ((l.barcode && l.barcode.toLowerCase() === cleanToken) || (l.nfc_tag && l.nfc_tag.toLowerCase() === cleanToken)))) return false;
    
    const temps = await localDB.temp_locations.toArray();
    if (temps.find(t => t.id !== currentEntityId && ((t.barcode && t.barcode.toLowerCase() === cleanToken) || (t.nfc_tag && t.nfc_tag.toLowerCase() === cleanToken)))) return false;
    
    const items = await localDB.items.toArray();
    if (items.find(i => i.id !== currentEntityId && ((i.barcode && i.barcode.toLowerCase() === cleanToken) || (i.nfc_tag && i.nfc_tag.toLowerCase() === cleanToken)))) return false;

    return true; 
}

async function isLocationNameUnique(name, currentEntityId = null) {
    const cleanName = String(name || "").trim().toLowerCase();
    if (!cleanName) return true;
    const locs = await localDB.locations.toArray();
    return !locs.some(loc => loc.id !== currentEntityId && String(loc.name || "").trim().toLowerCase() === cleanName);
}

/* =========================================================
   USER SETTINGS & PREFERENCES MANAGER
========================================================= */
async function getSettingsKey() {
    if (window.db) {
        const { data: { session } } = await window.db.auth.getSession();
        if (session && session.user) return `inventory_settings_${session.user.id}`;
    }
    return 'inventory_settings_default';
}

async function saveInventorySettings() {
    try { const key = await getSettingsKey(); localStorage.setItem(key, JSON.stringify(userSettings)); } catch (error) { console.warn("Could not save settings:", error); }
}

async function loadInventorySettings() {
    try {
        const key = await getSettingsKey(); 
        const saved = localStorage.getItem(key);
        if (saved) { 
            const parsed = JSON.parse(saved); 
            userSettings = { ...userSettings, ...parsed }; 
        }
        
        // 1. Load and apply Items View
        const itemsView = userSettings.view || 'medium';
        changeItemsView(itemsView);
        updateCustomSelectUI('changeItemsView', itemsView); // Updates the custom dropdown text!

        // 2. Load and apply Locations View
        const locsView = userSettings.locationsView || 'medium';
        changeLocationsView(locsView);
        updateCustomSelectUI('changeLocationsView', locsView); 
        
        // Note: If you add sorting/filtering saves in the future, 
        // you can easily sync those dropdowns the same way:
        // if (userSettings.sortOrder) updateCustomSelectUI('changeSortOrder', userSettings.sortOrder);

    } catch (error) { 
        console.warn("Could not load settings:", error); 
    }
}


function changeItemsView(view) { 
    const page = document.getElementById("pageItems");
    if (page) { page.classList.remove('items-view-small', 'items-view-medium', 'items-view-large', 'items-view-list'); page.classList.add(`items-view-${view}`); }
    userSettings.view = view; saveInventorySettings();
}

function changeLocationsView(viewValue) { 
    window.currentLocationsView = viewValue;
    const page = document.getElementById("pageLocations");
    if (page) { page.classList.remove('items-view-small', 'items-view-medium', 'items-view-large', 'items-view-list'); page.classList.add(`items-view-${viewValue}`); }
    userSettings.locationsView = viewValue; saveInventorySettings();
    refreshLocationAdmin();
}

function changeItemsBrowserMode(mode) { itemsBrowserMode = mode; showPage('pageItems'); }
function changeSortOrder(mode) { currentSortMode = mode; renderLocations(currentBrowserLocations); renderItems(currentBrowserItems); }
function changeSortOrderLocations(mode) { currentSortModeLocations = mode; refreshLocationAdmin(); }
function changeAdminLocationView(view) { adminLocationView = view; refreshLocationAdmin(); }


/* =========================================================
   INITIALIZATION & DEXIE OFFLINE LOADERS
========================================================= */
async function initInventory() {
    const { data: { session } } = await window.db.auth.getSession();
    if (session && session.user) currentUserEmail = session.user.email;

    await loadInventorySettings();
    initFabScrollFade();

    // 1. Instantly load the UI from the local Dexie Database
    await refreshAllDataFromLocal();

    // 2. Trigger the background engine to download fresh data from Supabase
    if (window.isAppOnline && typeof window.syncDatabaseToLocal === "function") {
        await window.syncDatabaseToLocal();
    }

    if (isImportingSyncLock) {
        console.log("Sync locked due to import. Skipping fetch.");
        return;
    }

    document.addEventListener("focus", function(event) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") { setTimeout(() => { if (typeof event.target.select === "function") event.target.select(); }, 30); }
    }, true); 
}

// Reads all data from IndexedDB and populates the memory arrays
async function refreshAllDataFromLocal() {
    try {
        const tData = await localDB.tags.toArray();
        const cData = await localDB.item_categories.toArray();
        const lData = await localDB.locations.toArray();
        const tempData = await localDB.temp_locations.toArray();

        // Populate Tags & Categories
        globalCachedTags = tData.sort((a,b) => a.name.localeCompare(b.name));
        globalCachedCategories = cData.sort((a,b) => a.name.localeCompare(b.name));
        
        const catHtml = globalCachedCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join("");
        if (document.getElementById("itemCategorySelect")) document.getElementById("itemCategorySelect").innerHTML = catHtml; 
        if (document.getElementById("editItemCategory")) document.getElementById("editItemCategory").innerHTML = catHtml;
        
        const tagHtml = '<option value="" selected disabled>Select a tag...</option>' + globalCachedTags.map(t => `<option value="${t.name}">${t.name}</option>`).join("");
        if (document.getElementById("itemTagSelect")) document.getElementById("itemTagSelect").innerHTML = tagHtml; 
        if (document.getElementById("editItemTagSelect")) document.getElementById("editItemTagSelect").innerHTML = tagHtml;

        // Populate Assignees
        tempLocationsAdmin = tempData;
        loadAssignDropdown();

        // Populate Locations
        locationsAdmin = lData.map(l => ({ id: l.id, name: l.name, parent: l.parent_id, barcode: l.barcode, nfc: l.nfc_tag, photo: l.photo_path, location_description: l.location_description, category: l.category }));
        refreshLocationAdmin();
        loadLocationDropdown();
        
        // Refresh Current Items View
        if (document.getElementById("pageItems").classList.contains("active")) {
            if (currentLocationId === "unallocated") loadUnallocatedItems();
            else if (currentLocationId) loadLocation(currentLocationId);
            else if (itemsBrowserMode === "flat") loadAllItemsFlat();
            else loadRootLocations();
        }
        
        // Refresh Temp Locations View if Active
        if (document.getElementById("pageTempLocations").classList.contains("active")) {
            if (currentTempLocationId) loadTempLocationDetails(currentTempLocationId);
            else loadTempLocationsAdmin();
        }

    } catch (e) { console.warn("Failed to read from local DB:", e); }
}

async function syncAfterWrite() {
    // Quick helper to immediately pull fresh data to Dexie after a Supabase write
    if (window.isAppOnline && typeof window.syncDatabaseToLocal === "function") {
        await window.syncDatabaseToLocal();
    }
}


/* =========================================================
   TAB & PAGE NAVIGATION
========================================================= */
function showPage(pageId) {
    document.querySelectorAll(".inventory-page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".tab-link").forEach(b => b.classList.remove("active"));
    
    const page = document.getElementById(pageId); if (page) page.classList.add("active");
    const tabMap = { 'pageItems': 'tab-items', 'pageLocations': 'tab-locations', 'pageTempLocations': 'tab-temp-locations', 'pageTags': 'tab-tags', 'pageCategories': 'tab-categories', 'pageSettings': 'tab-settings' };
    const tab = document.getElementById(tabMap[pageId]); if (tab) tab.classList.add("active");

    if (pageId !== "pageTempLocations") currentTempLocationId = null;

    if (pageId === "pageItems") {
        if (itemsBrowserMode === "flat") loadAllItemsFlat();
        else { if (currentLocationId === "unallocated") loadUnallocatedItems(); else if (currentLocationId) loadLocation(currentLocationId); else loadRootLocations(); }
    }
    if (pageId === "pageLocations") loadLocationsAdmin();
    if (pageId === "pageTempLocations") loadTempLocationsAdmin();
    if (pageId === "pageTags") loadTagsAdmin();
    if (pageId === "pageCategories") loadCategoriesAdmin();
    if (pageId === "pageSettings") loadAuditLogs(); 
    if (pageId === "pageSettings") {
        populateHardwareSettingsDropdowns();
    }

    // Control Mobile FAB visibility
    // Control Mobile FAB visibility
    const fabItem = document.getElementById("fabItemBtn"); 
    const fabLoc = document.getElementById("fabLocationBtn");
    const fabFilter = document.getElementById("fabFilterBtn");
    const fabContainer = document.getElementById("mobileFabContainer");
    
    if (window.innerWidth <= 768 && fabContainer) {
        // Keep container active so the ⚡ quick actions button stays operational across tabs
        fabContainer.style.display = "flex";
        fabContainer.style.position = "fixed";
        fabContainer.style.left = "16px";
        fabContainer.style.right = "auto";
        fabContainer.style.bottom = "16px";
        fabContainer.style.top = "auto";
        fabContainer.style.transform = "none";
        fabContainer.style.zIndex = "13000";
        fabContainer.style.visibility = "visible";
        fabContainer.style.opacity = "1";
        fabContainer.style.pointerEvents = "auto";
        
        if (pageId === "pageItems") {
            if (fabItem) fabItem.style.display = "flex";
            if (fabLoc) fabLoc.style.display = "none";  // Hidden on Items Browser
            if (fabFilter) fabFilter.style.display = "flex";
        } else if (pageId === "pageLocations") {
            if (fabItem) fabItem.style.display = "none";
            if (fabLoc) fabLoc.style.display = "flex";  // Only show on Locations tab
            if (fabFilter) fabFilter.style.display = "flex";
        } else {
            if (fabItem) fabItem.style.display = "none";
            if (fabLoc) fabLoc.style.display = "none";  // Hidden on all utility tabs
            if (fabFilter) fabFilter.style.display = "flex";
        }
    }
}

/* =========================================================
    ITEMS BROWSER LOGIC (DEXIE)
========================================================= */
async function loadRootLocations() {
    currentLocationId = null; locationHistory = [];
    const container = document.getElementById("breadcrumb");
    if (container) container.innerHTML = '<span class="breadcrumb-link active">Items</span>';
    const allLocs = await localDB.locations.toArray();
    const rootLocs = allLocs.filter(l => !l.parent_id);
    currentBrowserLocations = [...rootLocs, { id: "unallocated", name: "Unallocated Items" }];
    currentBrowserItems = [];
    renderLocations(currentBrowserLocations); renderItems(currentBrowserItems);
}

async function loadLocation(id) {
    currentLocationId = id;
    const loc = await localDB.locations.get(id); if (loc) await buildBreadcrumb(loc);
    currentBrowserLocations = await localDB.locations.where('parent_id').equals(id).toArray();
    currentBrowserItems = await localDB.items.where('location_id').equals(id).toArray();
    renderLocations(currentBrowserLocations); renderItems(currentBrowserItems);
}

function navigateToLocation(id) {
    if (id === "unallocated") { currentLocationId = "unallocated"; loadUnallocatedItems(); return; }
    currentLocationId = id; loadLocation(id);
}

async function loadUnallocatedItems() {
    const container = document.getElementById("breadcrumb");
    if (container) container.innerHTML = `<span class="breadcrumb-link" onclick="loadRootLocations()">Items</span><span class="breadcrumb-separator"> > </span><span class="breadcrumb-link active">Unallocated Items</span>`;
    currentBrowserLocations = [];
    const allItems = await localDB.items.toArray(); currentBrowserItems = allItems.filter(i => !i.location_id);
    renderLocations([]); renderItems(currentBrowserItems);
}

async function loadAllItemsFlat() {
    currentLocationId = null;
    const container = document.getElementById("breadcrumb");
    if (container) container.innerHTML = '<span class="breadcrumb-link active">All Items (Flat View)</span>';
    currentBrowserLocations = []; 
    currentBrowserItems = await localDB.items.toArray(); 
    renderLocations([]); renderItems(currentBrowserItems);
}

async function buildBreadcrumb(location) {
    let chain = [location]; let parentId = location.parent_id;
    while (parentId) {
        const parent = await localDB.locations.get(parentId); 
        if (parent) { chain.unshift(parent); parentId = parent.parent_id; } else break;
    }
    locationHistory = chain.slice(0, -1).map(l => l.id);
    const container = document.getElementById("breadcrumb"); if (!container) return; container.innerHTML = "";
    const rootLink = document.createElement("span"); rootLink.className = "breadcrumb-link"; rootLink.textContent = "Items"; rootLink.onclick = () => loadRootLocations(); container.appendChild(rootLink);
    chain.forEach((l, idx) => {
        const sep = document.createElement("span"); sep.className = "breadcrumb-separator"; sep.textContent = " > "; container.appendChild(sep);
        const link = document.createElement("span"); link.className = "breadcrumb-link"; link.textContent = l.name;
        if (idx === chain.length - 1) { link.classList.add("active"); } else { link.onclick = () => { currentLocationId = l.id; loadLocation(l.id); }; }
        container.appendChild(link);
    });
}



/* =========================================================
    TEMP LOCATIONS / ASSIGNEES LOGIC (DEXIE)
========================================================= */
async function loadTempLocationsAdmin() {
    tempLocationsAdmin = await localDB.temp_locations.toArray();
    currentTempLocationId = null;
    isStockUsageModeActive = false;
    stockUsageDraft.clear();
    document.getElementById("tempLocationTilesAdmin").style.display = "grid";
    document.getElementById("tempLocationItemsGrid").style.display = "none";
    const actionsToolbar = document.getElementById("tempLocationItemActionsToolbar");
    if (actionsToolbar) actionsToolbar.style.display = "none";
    const breadcrumb = document.getElementById("breadcrumbTempLocations");
    if (breadcrumb) breadcrumb.innerHTML = `<span class="breadcrumb-link active">Assigned Log</span>`;
    renderTempLocationTilesAdmin();
    loadAssignDropdown();
}

async function loadTempLocationDetails(tempId) {
    currentTempLocationId = tempId;
    const tempLoc = tempLocationsAdmin.find(t => t.id === tempId);
    const breadcrumb = document.getElementById("breadcrumbTempLocations");
    if (breadcrumb) breadcrumb.innerHTML = `<span class="breadcrumb-link" onclick="loadTempLocationsAdmin()">Assigned Log</span><span class="breadcrumb-separator"> > </span><span class="breadcrumb-link active">👤 ${tempLoc ? tempLoc.name : 'Assignee'}</span>`;
    document.getElementById("tempLocationTilesAdmin").style.display = "none";
    document.getElementById("tempLocationItemsGrid").style.display = "grid";
    const actionsToolbar = document.getElementById("tempLocationItemActionsToolbar");
    if (actionsToolbar) actionsToolbar.style.display = "flex";
    
    const items = await localDB.items.toArray();
    const assignedItems = items.filter(i => i.assigned_to === tempId);
    renderAssignedItems(assignedItems || []);
}

function renderTempLocationTilesAdmin() {
    const container = document.getElementById("tempLocationTilesAdmin"); if (!container) return; container.innerHTML = "";
    if (tempLocationsAdmin.length === 0) { container.style.display = "block"; container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; font-style: italic;">No temporary assignment locations created yet.</div>`; return; }
    container.style.display = "grid";
    tempLocationsAdmin.forEach(loc => {
        const div = document.createElement("div"); div.className = "item-card temp-location-card";
        let imgSrc = "../assets/images/folder-icon.jpg"; if (loc.photo_path) imgSrc = window.db.storage.from("location-photos").getPublicUrl(loc.photo_path).data.publicUrl;
        div.innerHTML = `<div class="cog" onclick="openTempLocationActions('${loc.id}');event.stopPropagation();">⚙️</div><div class="item-card-photo-wrapper" style="border-radius:50%;"><img src="${imgSrc}"></div><div class="item-card-name" style="color:#10b981;">${loc.name}</div>`;
        div.onclick = () => loadTempLocationDetails(loc.id); container.appendChild(div);
    });
}

function renderAssignedItems(items) {
    const container = document.getElementById("tempLocationItemsGrid");
    container.innerHTML = "";
    if (!items || items.length === 0) {
        container.style.display = "block";
        container.innerHTML = `<div style="padding: 40px; text-align: center; color: #999; font-style: italic;">No items currently checked out to this assignee.</div>`;
        return;
    }
    container.style.display = "grid";
    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "item-card";
        if (item.id === lastMovedItemId) card.classList.add("moved-item-highlight");

        let imgUrl = "../assets/images/no-image.jpg";
        if (item.photos?.length) {
            const defaultPhoto = item.photos.find(p => p.is_primary) || item.photos[0];
            imgUrl = window.db.storage.from("item-photos").getPublicUrl(defaultPhoto.file_path).data.publicUrl;
        }

        const locPath = item.location_id ? buildLocationPath(item.location_id) : "Unallocated";
        const isEquipment = String(item.quantity).trim() === "-";
        const maxQty = isEquipment ? 1 : Math.max(1, parseInt(item.quantity, 10) || 1);
        const selectedQty = stockUsageDraft.get(item.id) || 0;
        const qtyBadge = isEquipment ? "Tool" : `Qty: ${item.quantity}`;
        const actionHtml = isStockUsageModeActive
            ? `<div onclick="event.stopPropagation();" style="position:absolute; left:8px; right:8px; bottom:8px; background:#fff7ed; border:1px solid #fed7aa; border-radius:8px; padding:8px; z-index:10; box-shadow:0 2px 8px rgba(0,0,0,0.12);">
                    <div style="font-size:11px; font-weight:800; color:#c2410c; margin-bottom:6px;">Use quantity</div>
                    <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                        <button class="btn-outline" onclick="adjustStockUsageQuantity('${item.id}', -1); event.stopPropagation();" style="height:28px; min-width:28px; padding:0; font-weight:900;">-</button>
                        <input type="number" min="0" max="${maxQty}" value="${selectedQty}" onchange="setStockUsageQuantity('${item.id}', this.value); event.stopPropagation();" onclick="event.stopPropagation();" style="width:56px; height:30px; margin:0; text-align:center; font-weight:800; border-radius:6px;">
                        <button class="btn-outline" onclick="adjustStockUsageQuantity('${item.id}', 1); event.stopPropagation();" style="height:28px; min-width:28px; padding:0; font-weight:900;">+</button>
                    </div>
                    <button class="btn-primary" onclick="setStockUsageQuantity('${item.id}', ${maxQty}); event.stopPropagation();" style="width:100%; margin-top:6px; height:28px; background:#ef4444; border-color:#ef4444; font-size:11px;">Use all</button>
                </div>`
            : `<div onclick="executeReturnItem('${item.id}', true); event.stopPropagation();" style="position:absolute; top:8px; right:8px; background:#ef4444; color:white; padding:6px 10px; border-radius:6px; font-size:11px; font-weight:bold; z-index:10; box-shadow:0 2px 4px rgba(0,0,0,0.2); cursor:pointer;">Return Item</div>`;

        card.innerHTML = `<div class="item-card-photo-wrapper"><img src="${imgUrl}"></div><div class="item-card-qty-badge">${qtyBadge}</div>${actionHtml}<div class="item-card-name" style="margin-top: 10px;">${item.name}</div><div style="font-size: 11px; color: #666; margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 4px;"><span>Location:</span> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90%;">${locPath}</span></div>`;
        card.onclick = () => openItemDetails(item);
        container.appendChild(card);
    });
}

/* =========================================================
    MANAGEMENT LOGIC (NORMAL FOLDERS)
========================================================= */
function refreshLocationAdmin() {
    if (adminLocationView === "hierarchy") {
        if (!currentLocationAdmin) loadRootLocationsAdmin();
        else loadLocationAdmin(currentLocationAdmin);
    } else { loadFlatLocationsAdmin(); }
}

async function loadLocationsAdmin() {
    const lData = await localDB.locations.toArray();
    
    // Safely map the database columns to the UI's memory variables
    locationsAdmin = lData.map(l => ({ 
        id: l.id, 
        name: l.name, 
        parent: l.parent_id, // <--- This was the missing link!
        barcode: l.barcode, 
        nfc: l.nfc_tag, 
        photo: l.photo_path, 
        location_description: l.location_description, 
        category: l.category 
    }));
    
    refreshLocationAdmin();
    loadLocationDropdown();
}

function loadRootLocationsAdmin() {
    currentLocationAdmin = null;
    const container = document.getElementById("breadcrumbLocations");
    if (container) container.innerHTML = '<span class="breadcrumb-link active">Locations</span>';
    renderLocationTilesAdmin(locationsAdmin.filter(l => !l.parent));
}

function loadLocationAdmin(id) {
    currentLocationAdmin = id;
    buildAdminBreadcrumb(id);
    renderLocationTilesAdmin(locationsAdmin.filter(l => l.parent === id));
}

function loadFlatLocationsAdmin() {
    currentLocationAdmin = null;
    const container = document.getElementById("breadcrumbLocations");
    if (container) container.innerHTML = `<span class="breadcrumb-link" onclick="loadRootLocationsAdmin()">Locations</span><span class="breadcrumb-separator"> > </span><span class="breadcrumb-link active">All Locations</span>`;
    const list = locationsAdmin.map(l => ({ ...l, fullPath: buildLocationPath(l.id) })).sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    renderLocationTilesAdmin(list);
}

function buildAdminBreadcrumb(id) {
    const container = document.getElementById("breadcrumbLocations"); if (!container) return; container.innerHTML = "";
    const rootLink = document.createElement("span"); rootLink.className = "breadcrumb-link"; rootLink.textContent = "Locations"; rootLink.onclick = () => loadRootLocationsAdmin(); container.appendChild(rootLink);
    let loc = locationsAdmin.find(l => l.id === id); if (!loc) return;
    let chain = [loc]; while (loc.parent) { loc = locationsAdmin.find(l => l.id === loc.parent); if (!loc) break; chain.unshift(loc); }
    chain.forEach((l, idx) => {
        const sep = document.createElement("span"); sep.className = "breadcrumb-separator"; sep.textContent = " > "; container.appendChild(sep);
        const link = document.createElement("span"); link.className = "breadcrumb-link"; link.textContent = l.name;
        if (idx === chain.length - 1) link.classList.add("active"); else link.onclick = () => loadLocationAdmin(l.id); container.appendChild(link);
    });
}

const locationSelectIds = ["itemLocationSelect", "editItemLocationSelect", "moveItemLocationSelect"];

function buildLocationTreeOptions() {
    const byParent = new Map();
    (locationsAdmin || []).forEach(loc => {
        const parentKey = loc.parent || "";
        if (!byParent.has(parentKey)) byParent.set(parentKey, []);
        byParent.get(parentKey).push(loc);
    });
    byParent.forEach(list => list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))));

    const ordered = [];
    const walk = (parentId = "", depth = 0) => {
        (byParent.get(parentId) || []).forEach(loc => {
            ordered.push({ ...loc, depth, fullNamePath: buildLocationPath(loc.id) });
            walk(loc.id, depth + 1);
        });
    };
    walk("");
    return ordered;
}

function buildLocationChildrenMap() {
    const byParent = new Map();
    (locationsAdmin || []).forEach(loc => {
        const parentKey = loc.parent || "";
        if (!byParent.has(parentKey)) byParent.set(parentKey, []);
        byParent.get(parentKey).push(loc);
    });
    byParent.forEach(list => list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))));
    return byParent;
}

function getLocationAncestorIds(locationId) {
    const ancestors = [];
    let loc = (locationsAdmin || []).find(item => String(item.id) === String(locationId || ""));
    while (loc?.parent) {
        ancestors.unshift(loc.parent);
        loc = (locationsAdmin || []).find(item => String(item.id) === String(loc.parent));
    }
    return ancestors;
}

function getExpandedLocationIds(selectEl, wrapper) {
    const expanded = new Set((wrapper?.dataset.expandedLocations || "").split(",").filter(Boolean));
    return expanded;
}

function storeExpandedLocationIds(wrapper, expanded) {
    if (wrapper) wrapper.dataset.expandedLocations = Array.from(expanded).join(",");
}

function getLocationSelectLabel(value) {
    if (!value) return "No Location (Unallocated)";
    const loc = (locationsAdmin || []).find(item => String(item.id) === String(value));
    return loc ? buildLocationPath(loc.id) : "Select location...";
}

function syncLocationTreeSelection(selectEl, wrapper) {
    const triggerText = wrapper?.querySelector(".trigger-text");
    if (triggerText) triggerText.textContent = getLocationSelectLabel(selectEl.value);
    wrapper?.querySelectorAll(".custom-select-options li").forEach(option => {
        option.classList.toggle("selected", String(option.dataset.value || "") === String(selectEl.value || ""));
    });
}

function setLocationSelectValue(selectElOrId, value, flash = false) {
    const selectEl = typeof selectElOrId === "string" ? document.getElementById(selectElOrId) : selectElOrId;
    if (!selectEl) return;
    selectEl.value = value || "";
    const wrapper = selectEl.nextElementSibling?.classList?.contains("location-tree-select") ? selectEl.nextElementSibling : null;
    if (wrapper && value) {
        const expanded = getExpandedLocationIds(selectEl, wrapper);
        getLocationAncestorIds(value).forEach(id => expanded.add(id));
        storeExpandedLocationIds(wrapper, expanded);
        renderLocationTreeOptions(selectEl, wrapper);
    }
    syncLocationTreeSelection(selectEl, wrapper);
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    if (flash) {
        const targetVisual = wrapper?.querySelector(".custom-select-trigger") || selectEl;
        const originalBg = targetVisual.style.backgroundColor;
        const originalTransition = targetVisual.style.transition;
        targetVisual.style.transition = "background-color 0.4s ease";
        targetVisual.style.backgroundColor = "#dcfce7";
        setTimeout(() => {
            targetVisual.style.backgroundColor = originalBg;
            targetVisual.style.transition = originalTransition;
        }, 1000);
    }
}

function renderLocationTreeOptions(selectEl, wrapper) {
    const optionsList = wrapper.querySelector(".location-tree-options");
    if (!optionsList) return;
    const childrenMap = buildLocationChildrenMap();
    const expanded = getExpandedLocationIds(selectEl, wrapper);
    storeExpandedLocationIds(wrapper, expanded);
    optionsList.innerHTML = "";

    const emptyOption = document.createElement("li");
    emptyOption.dataset.value = "";
    emptyOption.className = "location-tree-option location-tree-leaf";
    emptyOption.innerHTML = `<span class="location-tree-caret"></span><span class="location-tree-name">No Location (Unallocated)</span>`;
    emptyOption.onclick = event => {
        event.stopPropagation();
        setLocationSelectValue(selectEl, "");
        optionsList.classList.remove("open");
    };
    optionsList.appendChild(emptyOption);

    const renderBranch = (parentId = "", depth = 0) => {
        (childrenMap.get(parentId) || []).forEach(loc => {
            const hasChildren = (childrenMap.get(loc.id) || []).length > 0;
            const isExpanded = expanded.has(loc.id);
            const option = document.createElement("li");
            option.dataset.value = loc.id;
            option.className = `location-tree-option${hasChildren ? " has-children" : " location-tree-leaf"}${isExpanded ? " expanded" : ""}`;
            option.style.setProperty("--tree-depth", depth);
            option.title = buildLocationPath(loc.id);
            option.innerHTML = `
                <span class="location-tree-caret">${hasChildren ? (isExpanded ? "v" : ">") : ""}</span>
                <span class="location-tree-name">${escapeHtml(loc.name)}</span>
                <button type="button" class="location-tree-set" title="Select location">Set</button>
            `;
            option.onclick = event => {
                event.stopPropagation();
                if (hasChildren) {
                    if (expanded.has(loc.id)) expanded.delete(loc.id);
                    else expanded.add(loc.id);
                    storeExpandedLocationIds(wrapper, expanded);
                    renderLocationTreeOptions(selectEl, wrapper);
                } else {
                    setLocationSelectValue(selectEl, loc.id);
                    optionsList.classList.remove("open");
                }
            };
            option.querySelector(".location-tree-set").onclick = event => {
                event.stopPropagation();
                setLocationSelectValue(selectEl, loc.id);
                optionsList.classList.remove("open");
            };
            optionsList.appendChild(option);
            if (hasChildren && isExpanded) renderBranch(loc.id, depth + 1);
        });
    };

    renderBranch();
    syncLocationTreeSelection(selectEl, wrapper);
}

function renderLocationTreeSelect(selectEl) {
    if (!selectEl) return;
    let wrapper = selectEl.nextElementSibling?.classList?.contains("location-tree-select") ? selectEl.nextElementSibling : null;
    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "custom-select-wrapper location-tree-select";
        wrapper.innerHTML = `
            <button type="button" class="custom-select-trigger location-tree-trigger">
                <span class="trigger-text"></span>
                <span class="caret">▼</span>
            </button>
            <ul class="custom-select-options location-tree-options"></ul>
        `;
        selectEl.insertAdjacentElement("afterend", wrapper);
        wrapper.querySelector(".custom-select-trigger").onclick = event => {
            event.stopPropagation();
            document.querySelectorAll(".custom-select-options").forEach(list => {
                if (list !== wrapper.querySelector(".custom-select-options")) list.classList.remove("open");
            });
            wrapper.querySelector(".custom-select-options")?.classList.toggle("open");
        };
    }

    selectEl.classList.add("native-location-select");
    selectEl.style.display = "none";
    renderLocationTreeOptions(selectEl, wrapper);
    syncLocationTreeSelection(selectEl, wrapper);
}

function loadLocationDropdown() {
    if (!locationsAdmin) locationsAdmin = [];
    const treeOptions = buildLocationTreeOptions();
    const combinedOptionsHtml = '<option value="">No Location (Unallocated)</option>' + treeOptions.map(item => `<option value="${item.id}">${escapeHtml(item.fullNamePath)}</option>`).join("");
    locationSelectIds.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = combinedOptionsHtml;
        if (currentValue && treeOptions.some(item => String(item.id) === String(currentValue))) select.value = currentValue;
        renderLocationTreeSelect(select);
    });
}

function loadAssignDropdown() {
    const select = document.getElementById("assignItemSelect"); if (!select) return;
    if (!tempLocationsAdmin || tempLocationsAdmin.length === 0) { select.innerHTML = '<option value="" disabled selected>No temporary locations created yet.</option>'; return; }
    select.innerHTML = '<option value="" disabled selected>Select assignee...</option>' + tempLocationsAdmin.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

/* =========================================================
    RENDERING ENGINE (Items & Locations Grids/Tables)
========================================================= */
function renderLocations(locations) {
    const container = document.getElementById("locationTiles"); container.innerHTML = "";
    let sortedLocs = [...locations];
    if (currentSortMode.includes('desc')) sortedLocs.sort((a,b) => b.name.localeCompare(a.name)); else sortedLocs.sort((a,b) => a.name.localeCompare(b.name));
    
    sortedLocs.forEach(loc => {
        const tile = document.createElement("div"); tile.className = "item-card location-card"; 
        
        // Check for custom photos and safely handle missing/null properties
        let imgSrc = "../assets/images/folder-icon.jpg";
        const photoKey = loc.photo_path || loc.photo;
        
        if (photoKey && photoKey !== "null" && photoKey !== "undefined") {
            imgSrc = window.db.storage.from("location-photos").getPublicUrl(photoKey).data.publicUrl;
        }
        
        tile.innerHTML = `
            <div class="item-card-photo-wrapper">
                <img src="${imgSrc}" onerror="this.onerror=null; this.src='../assets/images/folder-icon.jpg';">
            </div>
            <div class="item-card-qty-badge" style="background:#ff8c00;">Folder</div>
            <div class="item-card-name">${loc.name}</div>
        `;
        
        tile.onclick = () => navigateToLocation(loc.id); 
        container.appendChild(tile);
    });
}

function renderItems(items) {
    const container = document.getElementById("itemTiles"); const tableContainer = document.getElementById("itemsTableWrapper");
    container.innerHTML = ""; tableContainer.innerHTML = "";

    let sortedItems = [...(items || [])];
    if (currentSortMode === 'name_asc') sortedItems.sort((a,b) => a.name.localeCompare(b.name));
    else if (currentSortMode === 'name_desc') sortedItems.sort((a,b) => b.name.localeCompare(a.name));
    else if (currentSortMode === 'qty_desc') sortedItems.sort((a,b) => b.quantity - a.quantity);
    else if (currentSortMode === 'qty_asc') sortedItems.sort((a,b) => a.quantity - b.quantity);

    if (sortedItems.length > 0) {
        sortedItems.forEach(item => {
            const card = document.createElement("div"); card.className = "item-card"; if (item.id === lastMovedItemId) card.classList.add("moved-item-highlight");
            let imgUrl = "../assets/images/no-image.jpg"; if (item.photos?.length) { const defP = item.photos.find(p => p.is_primary) || item.photos[0]; imgUrl = window.db.storage.from("item-photos").getPublicUrl(defP.file_path).data.publicUrl; }
            let locPath = item.location_id ? buildLocationPath(item.location_id) : "Unallocated";
            
            let overlayHtml = ""; let quickReturnHtml = "";
            let isOutOfStock = (parseInt(item.quantity) === 0 || item.quantity === "0");
            
            // NEW: Hardware Equipment system flag evaluator
            let isEquipmentAsset = (String(item.quantity).trim() === "-");

            if (item.assigned_to) {
                const tempLoc = tempLocationsAdmin.find(t => t.id === item.assigned_to);
                overlayHtml = `<div class="assigned-overlay"><div class="assigned-icon">👤</div><div class="assigned-label">Out</div><div class="assigned-name">${tempLoc ? tempLoc.name : 'Unknown'}</div></div>`;
                quickReturnHtml = `<div onclick="executeReturnItem('${item.id}'); event.stopPropagation();" style="position:absolute; top:8px; right:10px; background:#ef4444; color:white; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:bold; z-index:10; box-shadow:0 2px 4px rgba(0,0,0,0.2); cursor:pointer;">📥 Return</div>`;
            } else if (!isEquipmentAsset && isOutOfStock) {
                overlayHtml = `<div class="assigned-overlay" style="background: rgba(30, 41, 59, 0.85); border-radius: 12px;"><div class="assigned-icon" style="font-size:22px;">📭</div><div class="assigned-label" style="color: #f87171; font-weight: bold;">Out of Stock</div></div>`;
            }

            // NEW: Dynamically shift quantity styling matrix to output "Equipment" pill if checked
            let qtyBadgeHtml = `<div class="item-card-qty-badge" style="${isOutOfStock ? 'background:#ef4444;' : ''}">Qty: ${item.quantity}</div>`;
            if (isEquipmentAsset) {
                qtyBadgeHtml = `<div class="item-card-qty-badge" style="background: #8b5cf6; font-weight: 700;">Equipment</div>`;
            }

            card.innerHTML = `<div class="item-card-photo-wrapper" style="${(!isEquipmentAsset && isOutOfStock) ? 'filter: grayscale(60%) opacity(0.7);' : ''}">${overlayHtml}<img src="${imgUrl}"></div>${qtyBadgeHtml}${quickReturnHtml}<div class="item-card-name" style="${(!isEquipmentAsset && isOutOfStock) ? 'color:#94a3b8;' : ''}">${item.name}</div><div style="font-size: 11px; color: #666; margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 4px; position: relative; z-index: 6;"><span>📍</span> <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 90%;">${locPath}</span></div>`;
            card.onclick = () => openItemDetails(item); container.appendChild(card);
        });
    }

    const combinedList = [];
    let sortedLocsForTable = [...(currentBrowserLocations || [])];
    if (currentSortMode.includes('desc')) sortedLocsForTable.sort((a,b) => b.name.localeCompare(a.name)); else sortedLocsForTable.sort((a,b) => a.name.localeCompare(b.name));
    if (sortedLocsForTable.length > 0) sortedLocsForTable.forEach(loc => { combinedList.push({ isLocation: true, id: loc.id, name: loc.name, barcode: loc.barcode || '', nfc_tag: loc.nfc || '', category: loc.category || 'storage', tags: '' }); });
    if (sortedItems.length > 0) sortedItems.forEach(item => { combinedList.push({ isLocation: false, id: item.id, name: item.name, quantity: item.quantity, barcode: item.barcode || '', nfc_tag: item.nfc_tag || '', category: item.category || '—', tags: item.tags ? (Array.isArray(item.tags) ? item.tags.join(', ') : JSON.stringify(item.tags)) : '—', rawItem: item }); });

    const c = userSettings.columns; const w = userSettings.widths;
    tableContainer.innerHTML = `<button class="col-picker-btn" onclick="toggleColumnMenu(event, 'itemColMenu')">⚙️</button>
        <div id="itemColMenu" class="col-picker-menu">
            <label><input type="checkbox" ${c.name ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'name', 1, this.checked)"> Name</label>
            <label><input type="checkbox" ${c.quantity ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'quantity', 2, this.checked)"> Quantity</label>
            <label><input type="checkbox" ${c.barcode ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'barcode', 3, this.checked)"> Barcode</label>
            <label><input type="checkbox" ${c.nfc ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'nfc', 4, this.checked)"> NFC Tag</label>
            <label><input type="checkbox" ${c.category ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'category', 5, this.checked)"> Category</label>
            <label><input type="checkbox" ${c.tags ? 'checked' : ''} onchange="toggleTableColumn('itemsTable', 'tags', 6, this.checked)"> Tags</label>
        </div>
        <table class="custom-table" id="itemsTable">
            <thead><tr><th style="width: 60px; min-width: 60px;">Photo</th><th style="width: ${w.name}; display: ${c.name ? '' : 'none'};">Name <div class="col-resizer"></div></th><th style="width: ${w.quantity}; display: ${c.quantity ? '' : 'none'};">Quantity <div class="col-resizer"></div></th><th style="width: ${w.barcode}; display: ${c.barcode ? '' : 'none'};">Barcode <div class="col-resizer"></div></th><th style="width: ${w.nfc}; display: ${c.nfc ? '' : 'none'};">NFC Tag <div class="col-resizer"></div></th><th style="width: ${w.category}; display: ${c.category ? '' : 'none'};">Category <div class="col-resizer"></div></th><th style="width: ${w.tags}; display: ${c.tags ? '' : 'none'};">Tags <div class="col-resizer"></div></th></tr></thead>
            <tbody></tbody>
        </table>`;

    const tbody = tableContainer.querySelector("tbody");
    if (combinedList.length === 0) {
        const activeLocation = currentLocationId && currentLocationId !== "unallocated" ? locationsAdmin.find(l => String(l.id) === String(currentLocationId)) : null;
        const emptyName = activeLocation ? activeLocation.name : (currentLocationId === "unallocated" ? "Unallocated Items" : "This location");
        const searchTerm = (activeSearchEmptyTerm || "").trim();
        const exactLocationMatch = searchTerm ? locationsAdmin.find(loc => String(loc.name || "").trim().toLowerCase() === searchTerm.toLowerCase()) : null;
        const emptyMessage = searchTerm
            ? `Unable to find item: ${escapeHtml(searchTerm)}${exactLocationMatch ? `<br><span style="display:block; margin-top:6px;">${escapeHtml(exactLocationMatch.name)} is empty!</span>` : ""}`
            : `${escapeHtml(emptyName)} is empty!`;
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #999; padding: 30px; font-style: italic;">Empty directory context</td></tr>`;
        container.style.display = "block"; container.innerHTML = `<div style="padding: 40px; text-align: center; color: #64748b; font-size: 16px; font-weight: 600; font-style: italic; background: #f8fafc; border-radius: 12px; border: 2px dashed #cbd5e1; margin-top: 10px;">${emptyMessage}</div>`;
    } else {
        container.style.display = "grid";
        combinedList.forEach(row => {
            const tr = document.createElement("tr"); tr.style.cursor = "pointer"; if (!row.isLocation && row.id === lastMovedItemId) tr.classList.add("moved-item-highlight");
            let rowImgSrc = "../assets/images/no-image.jpg"; 
            if (row.isLocation) {
                tr.onclick = () => navigateToLocation(row.id);
                const targetLocObj = locationsAdmin.find(l => l.id === row.id);
                if (targetLocObj && targetLocObj.photo) rowImgSrc = window.db.storage.from("location-photos").getPublicUrl(targetLocObj.photo).data.publicUrl; else rowImgSrc = "../assets/images/folder-icon.jpg";
                tr.innerHTML = `<td><img src="${rowImgSrc}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 6px;" onerror="this.onerror=null;this.src='../assets/images/folder-icon.jpg';"></td><td style="font-weight:700; color: #ff8c00; display: ${c.name ? '' : 'none'};">📦 ${row.name}</td><td style="color: #999; font-style: italic; display: ${c.quantity ? '' : 'none'};">—</td><td style="display: ${c.barcode ? '' : 'none'};">${row.barcode || '—'}</td><td style="display: ${c.nfc ? '' : 'none'};">${row.nfc_tag || '—'}</td><td style="text-transform: capitalize; display: ${c.category ? '' : 'none'};">${row.category || '—'}</td><td style="color: #999; display: ${c.tags ? '' : 'none'};">—</td>`;
            } else {
                tr.onclick = () => openItemDetails(row.rawItem);
                if (row.rawItem && row.rawItem.photos && row.rawItem.photos.length > 0) { const defaultPhoto = row.rawItem.photos.find(p => p.is_primary) || row.rawItem.photos[0]; rowImgSrc = window.db.storage.from("item-photos").getPublicUrl(defaultPhoto.file_path).data.publicUrl; }
                let nameHtml = row.name; if (row.rawItem.assigned_to) { const tempLoc = tempLocationsAdmin.find(t => t.id === row.rawItem.assigned_to); nameHtml = `<span style="color:#10b981;">👤 [Out: ${tempLoc ? tempLoc.name : 'User'}]</span> ${row.name}`; } else nameHtml = `🔹 ${row.name}`;
                tr.innerHTML = `<td><img src="${rowImgSrc}" style="width: 36px; height: 36px; object-fit: cover; border-radius: 6px;" onerror="this.onerror=null;this.src='../assets/images/no-image.jpg';"></td><td style="font-weight:600; display: ${c.name ? '' : 'none'};">${nameHtml}</td><td style="display: ${c.quantity ? '' : 'none'};">${row.quantity}</td><td style="display: ${c.barcode ? '' : 'none'};">${row.barcode || '—'}</td><td style="display: ${c.nfc ? '' : 'none'};">${row.nfc_tag || '—'}</td><td style="display: ${c.category ? '' : 'none'};">${row.category || '—'}</td><td style="display: ${c.tags ? '' : 'none'};">${row.tags}</td>`;
            }
            tbody.appendChild(tr);
        });
        initResizableColumns(document.getElementById("itemsTable"));
    }
}

function renderLocationTilesAdmin(list) {
    const tileContainer = document.getElementById("locationTilesAdmin"); const tableContainer = document.getElementById("locationsTableWrapper");
    if (!tileContainer || !tableContainer) return;
    if (typeof currentLocationsView !== 'undefined' && currentLocationsView === 'list') {
        tileContainer.style.display = "none"; tableContainer.style.display = "block";
        let html = `<table class="custom-table" style="width: 100%;"><thead><tr><th>Folder</th><th>Path / Name</th><th>Barcode ID</th><th>Hardware ID (NFC)</th><th style="text-align: right; padding-right: 25px;">Actions</th></tr></thead><tbody>`;
        list.forEach(loc => {
            let imgSrc = "../assets/images/folder-icon.jpg"; if (loc.photo) imgSrc = window.db.storage.from("location-photos").getPublicUrl(loc.photo).data.publicUrl; else if (loc.photo_path) imgSrc = window.db.storage.from("location-photos").getPublicUrl(loc.photo_path).data.publicUrl;
            html += `<tr onclick="openLocationActions('${loc.id}')" style="cursor: pointer;"><td style="width: 65px;"><img src="${imgSrc}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px;" onerror="this.src='../assets/images/folder-icon.jpg'"></td><td style="font-weight: 600; color: #004a99;">${adminLocationView === "flat" ? (loc.fullPath || loc.name) : (loc.name || "Unnamed Location")}</td><td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${loc.barcode || "—"}</code></td><td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${loc.nfc_tag || loc.nfc || "—"}</code></td><td style="text-align: right; padding-right: 15px;" onclick="event.stopPropagation();"><button class="btn-primary" onclick="openLocationActions('${loc.id}')" style="padding: 6px 12px; font-size: 12px; background:#004a99;">⚙️ Manage</button></td></tr>`;
        });
        html += `</tbody></table>`; tableContainer.innerHTML = html; return;
    }
    tableContainer.style.display = "none"; tileContainer.style.display = "grid"; tileContainer.innerHTML = "";
    let sortedList = [...list];
    if (typeof currentSortModeLocations !== 'undefined' && currentSortModeLocations === 'name_desc') { sortedList.sort((a, b) => { const nameA = adminLocationView === "flat" ? a.fullPath : a.name; const nameB = adminLocationView === "flat" ? b.fullPath : b.name; return nameB.localeCompare(nameA); }); } else { sortedList.sort((a, b) => { const nameA = adminLocationView === "flat" ? a.fullPath : a.name; const nameB = adminLocationView === "flat" ? b.fullPath : b.name; return nameA.localeCompare(nameB); }); }
    sortedList.forEach(loc => {
        const div = document.createElement("div"); div.className = "item-card location-card";
        let imgSrc = "../assets/images/folder-icon.jpg"; if (loc.photo) imgSrc = window.db.storage.from("location-photos").getPublicUrl(loc.photo).data.publicUrl; else if (loc.photo_path) imgSrc = window.db.storage.from("location-photos").getPublicUrl(loc.photo_path).data.publicUrl;
        div.innerHTML = `<div class="cog" onclick="openLocationActions('${loc.id}');event.stopPropagation();">⚙️</div><div class="item-card-photo-wrapper"><img src="${imgSrc}"></div><div class="item-card-name">${adminLocationView === "flat" ? loc.fullPath : loc.name}</div>`;
        if (adminLocationView === "hierarchy") div.onclick = () => loadLocationAdmin(loc.id); tileContainer.appendChild(div);
    });
}

function initResizableColumns(table) {
    if (!table) return; const cols = table.querySelectorAll("thead th");
    cols.forEach((col, idx) => {
        const resizer = col.querySelector(".col-resizer"); if (!resizer) return;
        resizer.addEventListener("mousedown", function(e) {
            e.preventDefault(); resizer.classList.add("resizing"); const startX = e.pageX; const startWidth = col.offsetWidth;
            function onMouseMove(moveEvent) { const currentWidth = startWidth + (moveEvent.pageX - startX); if (currentWidth > 60) col.style.width = currentWidth + "px"; }
            function onMouseUp() { resizer.classList.remove("resizing"); document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); const colKeys = ['name', 'quantity', 'barcode', 'nfc', 'category', 'tags']; const updatedCols = table.querySelectorAll("thead th"); updatedCols.forEach((th, i) => { if (colKeys[i]) userSettings.widths[colKeys[i]] = th.style.width || th.offsetWidth + "px"; }); saveInventorySettings(); }
            document.addEventListener("mousemove", onMouseMove); document.addEventListener("mouseup", onMouseUp);
        });
    });
}



function toggleTableColumn(tableId, colIndex, isVisible) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    // Toggle header
    const th = table.querySelectorAll("thead th")[colIndex];
    if (th) th.style.display = isVisible ? "" : "none";
    
    // Toggle body cells
    table.querySelectorAll("tbody tr").forEach(tr => {
        const td = tr.cells[colIndex];
        if (td) td.style.display = isVisible ? "" : "none";
    });
    
    // Save preference
    userSettings.auditLogColumns = userSettings.auditLogColumns || {};
    userSettings.auditLogColumns[colIndex] = isVisible;
    saveInventorySettings();
}

function applyColumnSettings() {
    if (!userSettings.auditLogColumns) return;
    Object.keys(userSettings.auditLogColumns).forEach(idx => {
        const isVisible = userSettings.auditLogColumns[idx];
        const checkbox = document.querySelector(`input[onchange*="toggleTableColumn('auditLogTable', ${idx}"]`);
        if (checkbox) checkbox.checked = isVisible;
        toggleTableColumn('auditLogTable', parseInt(idx), isVisible);
    });
}

/* =========================================================
   MULTIPLE PHOTOS & CAMERA PREVIEW RUNTIME HANDLERS
========================================================= */
function handleMultipleFilesSelection(input, previewContainerId, mode) {
    const files = input.files; if (!files) return;
    let targetArray; if (mode === 'add-item') targetArray = currentAddItemFiles; else if (mode === 'edit-item') targetArray = currentEditItemFiles;
    for (let i = 0; i < files.length; i++) targetArray.push(files[i]);
    renderMultipleFilesPreviews(previewContainerId, targetArray, mode, mode === 'edit-item' ? currentItemForActions.photos || [] : []);
}

function renderMultipleFilesPreviews(containerId, filesArray, mode, existingPhotos = []) {
    const container = document.getElementById(containerId); if (!container) return; container.innerHTML = "";
    existingPhotos.forEach((photo) => {
        const wrapper = document.createElement("div"); wrapper.style.cssText = "position: relative; width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 1px solid #ddd;";
        const img = document.createElement("img"); img.style.cssText = "width: 100%; height: 100%; object-fit: cover;"; img.src = window.db.storage.from("item-photos").getPublicUrl(photo.file_path).data.publicUrl;
        const removeBtn = document.createElement("div"); removeBtn.style.cssText = "position: absolute; top: 2px; right: 2px; background: rgba(239, 68, 68, 0.9); color: white; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; font-weight: bold; line-height: 1;"; removeBtn.innerHTML = "&times;";
        removeBtn.onclick = () => { existingItemPhotosToDelete.push(photo.file_path); const index = currentItemForActions.photos.findIndex(p => p.file_path === photo.file_path); if (index > -1) currentItemForActions.photos.splice(index, 1); if (primaryPhotoIdentifier === photo.file_path) primaryPhotoIdentifier = null; renderMultipleFilesPreviews(containerId, filesArray, mode, currentItemForActions.photos); };
        const starBtn = document.createElement("div"); const isPrimary = primaryPhotoIdentifier === photo.file_path || photo.is_primary; if (isPrimary && !primaryPhotoIdentifier) primaryPhotoIdentifier = photo.file_path;
        starBtn.style.cssText = `position: absolute; bottom: 2px; left: 2px; font-size: 12px; cursor: pointer; background: rgba(0,0,0,0.6); padding: 2px 4px; border-radius: 4px; color: ${isPrimary ? '#ffb000' : '#fff'};`; starBtn.innerHTML = isPrimary ? "★" : "☆";
        starBtn.onclick = () => { primaryPhotoIdentifier = photo.file_path; existingPhotos.forEach(p => p.is_primary = (p.file_path === photo.file_path)); renderMultipleFilesPreviews(containerId, filesArray, mode, existingPhotos); };
        wrapper.appendChild(img); wrapper.appendChild(removeBtn); wrapper.appendChild(starBtn); container.appendChild(wrapper);
    });

    if (filesArray.length === 0 && existingPhotos.length === 0) {
        container.innerHTML = `<img src="../assets/images/no-image.jpg" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #ddd;">`; return;
    }

    filesArray.forEach((file, index) => {
        const wrapper = document.createElement("div"); wrapper.style.cssText = "position: relative; width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 1px solid #ddd;";
        const img = document.createElement("img"); img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
        const reader = new FileReader(); reader.onload = (e) => { img.src = e.target.result; }; reader.readAsDataURL(file);
        const removeBtn = document.createElement("div"); removeBtn.style.cssText = "position: absolute; top: 2px; right: 2px; background: rgba(239, 68, 68, 0.9); color: white; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; font-weight: bold; line-height: 1;"; removeBtn.innerHTML = "&times;";
        removeBtn.onclick = () => { if (primaryPhotoIdentifier === file.name) primaryPhotoIdentifier = null; filesArray.splice(index, 1); renderMultipleFilesPreviews(containerId, filesArray, mode, existingPhotos); };
        const starBtn = document.createElement("div"); const isPrimary = primaryPhotoIdentifier === file.name;
        starBtn.style.cssText = `position: absolute; bottom: 2px; left: 2px; font-size: 12px; cursor: pointer; background: rgba(0,0,0,0.6); padding: 2px 4px; border-radius: 4px; color: ${isPrimary ? '#ffb000' : '#fff'};`; starBtn.innerHTML = isPrimary ? "★" : "☆";
        starBtn.onclick = () => { primaryPhotoIdentifier = file.name; if (mode === 'edit-item') existingPhotos.forEach(p => p.is_primary = false); renderMultipleFilesPreviews(containerId, filesArray, mode, existingPhotos); };
        wrapper.appendChild(img); wrapper.appendChild(removeBtn); wrapper.appendChild(starBtn); container.appendChild(wrapper);
    });
}

function previewLocationImage(input, previewId, mode) {
    if (input.files && input.files[0]) {
        const file = input.files[0]; if (mode === 'add') currentAddLocationFiles = [file]; else currentEditLocationFile = file;
        const reader = new FileReader(); reader.onload = (e) => document.getElementById(previewId).src = e.target.result; reader.readAsDataURL(file);
    }
}
function deleteLocationPhoto() { document.getElementById('editLocationPreview').src = "../assets/images/folder-icon.jpg"; document.getElementById('editLocationPhotoInput').value = ""; document.getElementById('editLocationCameraInput').value = ""; currentEditLocationFile = null; window.locationPhotoDeleted = true; }
function deleteTempLocationPhoto() { document.getElementById('editTempLocationPreview').src = "../assets/images/folder-icon.jpg"; document.getElementById('editTempLocationPhotoInput').value = ""; document.getElementById('editTempLocationCameraInput').value = ""; currentEditLocationFile = null; window.locationPhotoDeleted = true; }
function previewTempLocationImage(input, previewId, mode) {
    if (input.files && input.files[0]) {
        const file = input.files[0];
        if (mode === 'add') currentAddLocationFiles = [file];
        else currentEditLocationFile = file;
        const reader = new FileReader();
        reader.onload = (e) => document.getElementById(previewId).src = e.target.result;
        reader.readAsDataURL(file);
    }
}

let photoCaptureStream = null;
let photoCaptureMode = null;

function ensurePhotoCaptureModal() {
    let modal = document.getElementById("photoCaptureModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "photoCaptureModal";
    modal.className = "modal";
    modal.style.zIndex = "10020";
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 460px; text-align: center;">
            <h3 style="margin-top:0; color:#004a99;">Camera Photo</h3>
            <video id="photoCaptureVideo" autoplay playsinline muted style="width:100%; max-height:360px; background:#111; border-radius:12px; object-fit:cover;"></video>
            <canvas id="photoCaptureCanvas" style="display:none;"></canvas>
            <div class="modal-buttons" style="margin-top:16px; display:flex; gap:10px; justify-content:center;">
                <button class="btn-outline" onclick="closePhotoCaptureModal()">Cancel</button>
                <button class="btn-primary" onclick="capturePhotoFromDevice()">Use Photo</button>
            </div>
            <button class="btn-outline" onclick="fallbackPhotoFilePicker()" style="width:100%; margin-top:10px;">Choose file instead</button>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function stopPhotoCaptureStream() {
    if (photoCaptureStream) {
        photoCaptureStream.getTracks().forEach(track => track.stop());
        photoCaptureStream = null;
    }
}

async function openPhotoCaptureModal(mode) {
    photoCaptureMode = mode;
    const modal = ensurePhotoCaptureModal();
    const video = document.getElementById("photoCaptureVideo");
    modal.style.display = "flex";

    try {
        stopPhotoCaptureStream();
        photoCaptureStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });
        video.srcObject = photoCaptureStream;
        await video.play();
    } catch (error) {
        console.warn("Device camera unavailable, falling back to file picker:", error);
        closePhotoCaptureModal();
        fallbackPhotoFilePicker(mode);
    }
}

function closePhotoCaptureModal() {
    stopPhotoCaptureStream();
    const modal = document.getElementById("photoCaptureModal");
    if (modal) modal.style.display = "none";
}

function fallbackPhotoFilePicker(mode = photoCaptureMode) {
    const inputMap = {
        "add-item": "addItemCameraInput",
        "edit-item": "editItemCameraInput",
        "add-location": "addLocationCameraInput",
        "edit-location": "editLocationCameraInput",
        "add-temp-location": "addTempLocationCameraInput",
        "edit-temp-location": "editTempLocationCameraInput"
    };
    const input = document.getElementById(inputMap[mode]);
    if (input) input.click();
}

function addCapturedPhotoToTarget(file, mode) {
    if (mode === "add-item") {
        currentAddItemFiles.push(file);
        renderMultipleFilesPreviews("addItemPreviewsRow", currentAddItemFiles, "add-item");
        return;
    }
    if (mode === "edit-item") {
        currentEditItemFiles.push(file);
        renderMultipleFilesPreviews("editItemPreviewsRow", currentEditItemFiles, "edit-item", currentItemForActions?.photos || []);
        return;
    }

    const previewMap = {
        "add-location": "addLocationPreview",
        "edit-location": "editLocationPreview",
        "add-temp-location": "addTempLocationPreview",
        "edit-temp-location": "editTempLocationPreview"
    };
    if (mode === "add-location" || mode === "add-temp-location") currentAddLocationFiles = [file];
    if (mode === "edit-location" || mode === "edit-temp-location") {
        currentEditLocationFile = file;
        window.locationPhotoDeleted = false;
    }

    const preview = document.getElementById(previewMap[mode]);
    if (preview) preview.src = URL.createObjectURL(file);
}

async function capturePhotoFromDevice() {
    const video = document.getElementById("photoCaptureVideo");
    const canvas = document.getElementById("photoCaptureCanvas");
    if (!video || !canvas || !photoCaptureMode) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(video, 0, 0, width, height);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return;
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    addCapturedPhotoToTarget(file, photoCaptureMode);
    closePhotoCaptureModal();
}

/* =========================================================
   ITEM ACTIONS (CRUD)
========================================================= */
function wrapItemFormField(label, field) {
    const wrap = document.createElement("div");
    wrap.className = "item-form-field";
    if (label) wrap.append(label);
    if (field) wrap.append(field);
    return wrap;
}

function makeItemFormLabel(text) {
    const label = document.createElement("label");
    label.textContent = text;
    return label;
}

function normaliseQuantityWrapper(wrapper) {
    if (!wrapper) return;
    const nestedControl = Array.from(wrapper.children).find(child => child.tagName === "DIV" && child.querySelector("input"));
    if (!nestedControl) return;
    Array.from(nestedControl.childNodes).forEach(child => wrapper.appendChild(child));
    nestedControl.remove();
}

function ensureAddItemLayout() {
    const content = document.querySelector("#addItemModal .item-form-modal-content");
    if (!content || content.dataset.layoutReady === "true") return;

    const title = content.querySelector(".item-form-title");
    const preview = document.getElementById("addItemPreviewsRow");
    const photoLabel = preview?.previousElementSibling;
    const photoButtons = preview?.nextElementSibling;
    const name = document.getElementById("itemName");
    const qty = document.getElementById("itemQuantity");
    const qtyWrapper = document.getElementById("addItemQtyWrapper");
    const location = document.getElementById("itemLocationSelect");
    const description = document.getElementById("itemDescription");
    const barcodeRow = document.getElementById("addItemBarcode")?.closest("div[style*='align-items: flex-end']");
    const nfcRow = document.getElementById("addItemNFC")?.closest("div[style*='align-items: flex-end']");
    const category = document.getElementById("itemCategorySelect");
    const tagSelect = document.getElementById("itemTagSelect");
    const tagPills = document.getElementById("addItemTagsPillsRow");
    const buttons = content.querySelector(".modal-buttons");

    if (!title || !preview || !photoLabel || !photoButtons || !name || !qty || !qtyWrapper || !location || !description || !category || !tagSelect || !tagPills || !buttons) return;

    ensureItemModalCloseButton("addItemModal", ".item-form-title", "addItemModal");

    const nameLabel = name.previousElementSibling;
    const qtyLabel = qtyWrapper.previousElementSibling;
    const locationLabel = location.parentElement?.previousElementSibling || makeItemFormLabel("Location Placement Folder");
    const descriptionLabel = description.previousElementSibling;
    const categoryRow = category.parentElement;
    const categoryLabel = categoryRow?.previousElementSibling;
    const tagRow = tagSelect.parentElement;
    const tagLabel = tagRow?.previousElementSibling;
    const locationBarcodeBtn = document.querySelector("button[onclick=\"openBarcodeScannerModal('itemLocationTunnel')\"]");
    const locationNfcBtn = document.querySelector("button[onclick=\"openNfcScannerModal('itemLocationTunnel')\"]");
    const addBarcodeInput = document.getElementById("addItemBarcode");
    const addNfcInput = document.getElementById("addItemNFC");

    const media = document.createElement("div");
    media.className = "item-form-media";
    media.append(photoLabel, preview, photoButtons);

    const addToolToggle = document.getElementById("addItemEquipmentToggle") || createToolToggleButton("addItemEquipmentToggle", false, toggleAddItemEquipment);
    addToolToggle.className = "item-form-tool-toggle";
    initialiseToolToggle(addToolToggle);
    addToolToggle.onclick = toggleAddItemEquipment;
    addToolToggle.setAttribute("aria-label", "Toggle item tool mode");
    normaliseQuantityWrapper(qtyWrapper);

    const addHardwareColumn = document.createElement("div");
    addHardwareColumn.className = "item-form-hardware-column";
    const addBarcodeButton = document.createElement("button");
    addBarcodeButton.type = "button";
    addBarcodeButton.id = "btnAddItemBarcodeAction";
    addBarcodeButton.className = "btn-outline item-form-hardware-action";
    addBarcodeButton.onclick = triggerAddItemBarcodeScan;
    const addNfcButton = document.createElement("button");
    addNfcButton.type = "button";
    addNfcButton.id = "btnAddItemNfcAction";
    addNfcButton.className = "btn-outline item-form-hardware-action";
    addNfcButton.onclick = triggerAddItemNfcScan;
    addHardwareColumn.append(
        wrapItemFormField(makeItemFormLabel("Barcode"), addBarcodeButton),
        wrapItemFormField(makeItemFormLabel("NFC"), addNfcButton)
    );
    if (addBarcodeInput) { addBarcodeInput.type = "hidden"; addHardwareColumn.append(addBarcodeInput); }
    if (addNfcInput) { addNfcInput.type = "hidden"; addHardwareColumn.append(addNfcInput); }

    const quantityToolRow = document.createElement("div");
    quantityToolRow.className = "item-form-quantity-tool-row";
    const addNumberColumn = document.createElement("div");
    addNumberColumn.className = "item-form-number-column";
    addNumberColumn.append(qtyWrapper, ensureMinimumOrderControl("add"), addToolToggle);
    quantityToolRow.append(addNumberColumn, addHardwareColumn);

    const locationRow = document.createElement("div");
    locationRow.className = "item-form-location-row";
    locationRow.append(location);
    const addLocationBtn = document.querySelector("button[onclick=\"openAddLocationFromItemModal('itemLocationSelect')\"]");
    if (addLocationBtn) locationRow.append(addLocationBtn);
    if (locationBarcodeBtn) locationRow.append(locationBarcodeBtn);
    if (locationNfcBtn) locationRow.append(locationNfcBtn);

    const identityRow = document.createElement("div");
    identityRow.className = "item-form-identity-row";
    if (barcodeRow) identityRow.append(barcodeRow);
    if (nfcRow) identityRow.append(nfcRow);

    const tagsBlock = document.createElement("div");
    tagsBlock.className = "item-form-tags-block";
    tagsBlock.append(tagLabel, tagRow, tagPills);

    const actionStack = document.createElement("div");
    const cancelBtn = Array.from(buttons.children).find(btn => btn.textContent.trim().toLowerCase() === "cancel");
    const saveAnotherBtn = Array.from(buttons.children).find(btn => btn.textContent.trim().toLowerCase().includes("another"));
    const saveBtn = Array.from(buttons.children).find(btn => btn.getAttribute("onclick") === "addItem()");
    if (saveBtn) saveBtn.textContent = "Save";
    stackItemFormActions(actionStack, [saveBtn, saveAnotherBtn, cancelBtn]);

    content.innerHTML = "";
    content.append(
        title,
        media,
        wrapItemFormField(nameLabel, name),
        wrapItemFormField(descriptionLabel, description),
        wrapItemFormField(qtyLabel, quantityToolRow),
        wrapItemFormField(locationLabel, locationRow),
        wrapItemFormField(categoryLabel, categoryRow),
        tagsBlock,
        actionStack
    );
    renderLocationTreeSelect(location);
    content.dataset.layoutReady = "true";
    updateAddItemHardwareButtonsUI();
}

function ensureEditItemLayout() {
    const content = document.querySelector("#itemEditModal .item-form-modal-content");
    if (!content || content.dataset.layoutReady === "true") return;

    const title = content.querySelector(".item-form-title");
    const preview = document.getElementById("editItemPreviewsRow");
    const photoButtons = document.getElementById("editItemPhotoInput")?.parentElement;
    const name = document.getElementById("editItemName");
    const description = document.getElementById("editItemDescription");
    const qtyWrapper = document.getElementById("editItemQtyWrapper");
    const equipmentCheckbox = document.getElementById("editItemIsEquipment");
    const equipmentBox = equipmentCheckbox?.parentElement;
    const category = document.getElementById("editItemCategory");
    const barcodeBtn = document.getElementById("btnEditModalBarcodeAction");
    const nfcBtn = document.getElementById("btnEditModalNfcAction");
    const location = document.getElementById("editItemLocationSelect");
    const tagSelect = document.getElementById("editItemTagSelect");
    const tagPills = document.getElementById("editItemTagsPillsRow");
    const saveBtn = content.querySelector("button[onclick='saveItemEdits()']");
    const cancelBtn = content.querySelector("button[onclick=\"confirmCancel('itemEditModal')\"]");
    const deleteBtn = content.querySelector("button[onclick='attemptDeleteItem()']");

    if (!title || !preview || !photoButtons || !name || !description || !qtyWrapper || !equipmentBox || !category || !barcodeBtn || !nfcBtn || !location || !tagSelect || !tagPills || !saveBtn || !cancelBtn || !deleteBtn) return;

    ensureItemModalCloseButton("itemEditModal", ".item-form-title", "itemEditModal");

    const nameLabel = name.previousElementSibling;
    const descriptionLabel = description.previousElementSibling;
    const qtyLabel = qtyWrapper.querySelector("label");
    normaliseQuantityWrapper(qtyWrapper);
    const categoryLabel = category.previousElementSibling;
    const locationLabel = location.closest("div[style*='margin-bottom']")?.querySelector("label");
    const tagsLabel = tagSelect.closest("div")?.parentElement?.querySelector("label");
    const addLocationBtn = document.querySelector("button[onclick=\"openAddLocationFromItemModal('editItemLocationSelect')\"]");
    const scanLocationBtn = document.querySelector("button[onclick=\"openBarcodeScannerModal('editItemLocationSelect')\"]");
    const addTagBtn = tagSelect.parentElement?.querySelector("button");

    const media = document.createElement("div");
    media.className = "item-form-media";
    media.append(preview, photoButtons);

    const editToolToggle = createToolToggleButton("editItemEquipmentToggle", !!equipmentCheckbox?.checked, () => {
        if (!equipmentCheckbox) return;
        equipmentCheckbox.checked = !equipmentCheckbox.checked;
        handleEquipmentCheckboxToggle(equipmentCheckbox.checked);
    });
    if (equipmentBox) equipmentBox.style.display = "none";
    if (equipmentCheckbox) equipmentCheckbox.style.display = "none";

    const identityRow = document.createElement("div");
    identityRow.className = "item-form-hardware-column";
    barcodeBtn.classList.add("item-form-hardware-action");
    nfcBtn.classList.add("item-form-hardware-action");
    const barcodeField = wrapItemFormField(makeItemFormLabel("Barcode"), barcodeBtn);
    const nfcField = wrapItemFormField(makeItemFormLabel("NFC"), nfcBtn);
    identityRow.append(barcodeField, nfcField);

    const quantityToolRow = document.createElement("div");
    quantityToolRow.className = "item-form-quantity-tool-row";
    const editNumberColumn = document.createElement("div");
    editNumberColumn.className = "item-form-number-column";
    editNumberColumn.append(qtyWrapper, ensureMinimumOrderControl("edit"), editToolToggle);
    quantityToolRow.append(editNumberColumn, identityRow);
    if (equipmentCheckbox) quantityToolRow.append(equipmentCheckbox);

    const locationRow = document.createElement("div");
    locationRow.className = "item-form-location-row";
    locationRow.append(location);
    if (addLocationBtn) locationRow.append(addLocationBtn);
    if (scanLocationBtn) locationRow.append(scanLocationBtn);

    const categoryRow = document.createElement("div");
    categoryRow.className = "item-form-picker-row";
    categoryRow.append(category);

    const tagRow = document.createElement("div");
    tagRow.className = "item-form-picker-row";
    tagRow.append(tagSelect);
    if (addTagBtn) tagRow.append(addTagBtn);

    const tagsBlock = document.createElement("div");
    tagsBlock.className = "item-form-tags-block";
    tagsBlock.append(tagsLabel, tagRow, tagPills);

    const actionStack = document.createElement("div");
    stackItemFormActions(actionStack, [saveBtn, deleteBtn, cancelBtn]);

    content.innerHTML = "";
    content.append(
        title,
        media,
        wrapItemFormField(nameLabel, name),
        wrapItemFormField(descriptionLabel, description),
        wrapItemFormField(qtyLabel, quantityToolRow),
        wrapItemFormField(locationLabel, locationRow),
        wrapItemFormField(categoryLabel, categoryRow),
        tagsBlock,
        actionStack
    );
    renderLocationTreeSelect(location);
    content.dataset.layoutReady = "true";
    handleEquipmentCheckboxToggle(!!equipmentCheckbox?.checked);
}

function openAddItemModal() { 
    ensureAddItemLayout();
    document.getElementById("itemName").value = ""; document.getElementById("itemQuantity").value = "1"; document.getElementById("itemDescription").value = ""; document.getElementById("addItemBarcode").value = ""; document.getElementById("addItemNFC").value = ""; document.getElementById("addItemPhotoInput").value = ""; document.getElementById("addItemCameraInput").value = "";
    const minimumOrder = document.getElementById("addItemMinimumOrder");
    if (minimumOrder) minimumOrder.value = "-";
    setAddItemEquipmentState(false);
    currentAddItemFiles = []; primaryPhotoIdentifier = null; renderMultipleFilesPreviews('addItemPreviewsRow', currentAddItemFiles, 'add-item');
    activeSelectedAddTags = []; renderActiveTagPills('add');
    const selectEl = document.getElementById("itemLocationSelect"); if (selectEl) setLocationSelectValue(selectEl, (currentLocationId && currentLocationId !== "unallocated") ? currentLocationId : "");
    document.getElementById("addItemModal").style.display = "flex"; 
    markModalClean("addItemModal");
}

function closeAddItemModal() { closeModalClean("addItemModal"); }

function setAddItemEquipmentState(isEquipment) {
    const wrapper = document.getElementById("addItemQtyWrapper");
    const input = document.getElementById("itemQuantity");
    const minimumWrapper = document.getElementById("addItemMinimumOrderWrapper");
    const minimumInput = document.getElementById("addItemMinimumOrder");
    const toggle = document.getElementById("addItemEquipmentToggle");
    if (!input) return;
    setNumberControlDisabledState(wrapper, input, isEquipment, "-", "1");
    setNumberControlDisabledState(minimumWrapper, minimumInput, isEquipment, "-", "-");
    setToolToggleVisual(toggle, isEquipment);
    updateAddItemHardwareButtonsUI();
}

function toggleAddItemEquipment() {
    const toggle = document.getElementById("addItemEquipmentToggle");
    setAddItemEquipmentState(toggle?.dataset.active !== "true");
}

function adjustAddItemQty(amount) {
    const input = document.getElementById("itemQuantity");
    const toggle = document.getElementById("addItemEquipmentToggle");
    if (!input || toggle?.dataset.active === "true") return;
    let value = (parseInt(input.value, 10) || 0) + amount;
    if (value < 0) value = 0;
    input.value = value;
}

function updateAddItemHardwareButtonsUI() {
    const barcodeBtn = document.getElementById("btnAddItemBarcodeAction");
    const nfcBtn = document.getElementById("btnAddItemNfcAction");
    const barcodeValue = document.getElementById("addItemBarcode")?.value?.trim() || "";
    const nfcValue = document.getElementById("addItemNFC")?.value?.trim() || "";
    if (barcodeBtn) {
        barcodeBtn.textContent = barcodeValue ? `Barcode: ${barcodeValue}` : "No Barcode";
        barcodeBtn.classList.toggle("has-value", !!barcodeValue);
    }
    if (nfcBtn) {
        nfcBtn.textContent = nfcValue ? `NFC: ${nfcValue}` : "NFC Ready (Tap)";
        nfcBtn.classList.toggle("has-value", !!nfcValue);
    }
}

async function triggerAddItemBarcodeScan() {
    const input = document.getElementById("addItemBarcode");
    if (input?.value?.trim()) {
        const rewrite = await customConfirm("A barcode is already mapped to this new item. Do you want to replace it?", "Manage Barcode");
        if (!rewrite) return;
        input.value = "";
        updateAddItemHardwareButtonsUI();
    }
    openBarcodeScannerModal("addItemBarcode");
}

async function triggerAddItemNfcScan() {
    const input = document.getElementById("addItemNFC");
    if (input?.value?.trim()) {
        const rewrite = await customConfirm("An NFC tag is already mapped to this new item. Do you want to replace it?", "Manage NFC Tag");
        if (!rewrite) return;
        input.value = "";
        updateAddItemHardwareButtonsUI();
    }
    openNfcScannerModal("addItemNFC");
}

async function addItem(addAnother = false) {
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        const name = document.getElementById("itemName").value;
        const isEquipment = document.getElementById("addItemEquipmentToggle")?.dataset.active === "true";
        const quantity = isEquipment ? "-" : (parseInt(document.getElementById("itemQuantity").value) || 0);
        const quantity_minimum_order = normaliseMinimumOrderValue(document.getElementById("addItemMinimumOrder")?.value);
        const location_id = document.getElementById("itemLocationSelect").value || null;
        const description = document.getElementById("itemDescription").value;
        const category = document.getElementById("itemCategorySelect").value || 'tools';
        const barcode = document.getElementById("addItemBarcode").value;
        const nfc_tag = document.getElementById("addItemNFC").value;

        if (!name) return await customAlert("Please enter an item name", "Missing Data");
        if (barcode && !(await isHardwareTagUnique(barcode))) return await customAlert("That Barcode ID is already registered!", "Duplicate Code");
        if (nfc_tag && !(await isHardwareTagUnique(nfc_tag))) return await customAlert("That NFC Tag is already registered!", "Duplicate Code");

        // Use the new Universal Writer!
        const payload = { name, quantity, quantity_minimum_order, location_id, description, category, barcode, nfc_tag, tags: activeSelectedAddTags };
        const response = await window.offlineSafeWrite('CREATE', 'items', payload);

        if (response.success) {
            const newItemId = response.id; // We get the UUID instantly!
            
            // Handle Offline Photos
            if (currentAddItemFiles.length > 0) {
                if (!primaryPhotoIdentifier) primaryPhotoIdentifier = currentAddItemFiles[0].name;
                for (let i = 0; i < currentAddItemFiles.length; i++) {
                    const file = currentAddItemFiles[i];
                    const fileName = `item-${newItemId}-${Date.now()}-${i}`;
                    const isPrimary = file.name === primaryPhotoIdentifier;
                    
                    // Convert the image to text and save to the Offline Queue!
                    const base64Data = await window.fileToBase64(file);
                    await localDB.sync_photos_queue.add({
                        record_id: newItemId, record_type: 'item', bucket: 'item-photos',
                        file_name: fileName, base64_data: base64Data, is_primary: isPrimary, status: 'pending'
                    });
                }
            }
            
            logAction("CREATE", "Item", name, `Added quantity: ${quantity}`);
            
            await refreshAllDataFromLocal(); // Instantly update the UI without waiting for internet!
            window.processSyncQueue(); // Tell the engine to try uploading if we have a signal
            if (addAnother) {
                openAddItemModal();
            } else {
                closeAddItemModal();
            }
        }
    } finally { window.isProcessingTransaction = false; }
}
async function switchToItemEdit() {
    if (!currentItemForActions) return;
    closeModal('itemDetailsModal');
    const item = currentItemForActions;

    try {
        if (document.getElementById("editItemName")) document.getElementById("editItemName").value = item.name || "";
        if (document.getElementById("editItemDescription")) document.getElementById("editItemDescription").value = item.description || "";
        if (document.getElementById("editItemBarcode")) document.getElementById("editItemBarcode").value = item.barcode || "";
        if (document.getElementById("editItemNFC")) document.getElementById("editItemNFC").value = item.nfc_tag || "";
        if (document.getElementById("editItemCategory")) document.getElementById("editItemCategory").value = item.category || "tools";
        if (document.getElementById("editItemLocationSelect")) setLocationSelectValue("editItemLocationSelect", item.location_id || "");

        // NEW: Evaluate Equipment status flag, toggle UI visibility parameters instantly
        const isEquipment = (String(item.quantity).trim() === "-");
        const checkbox = document.getElementById("editItemIsEquipment");
        if (checkbox) {
            checkbox.checked = isEquipment;
            handleEquipmentCheckboxToggle(isEquipment);
        }
        
        if (!isEquipment) {
            document.getElementById("editItemQuantity").value = item.quantity || 0;
        }
        const editMinimumOrder = document.getElementById("editItemMinimumOrder");
        if (editMinimumOrder) editMinimumOrder.value = normaliseMinimumOrderValue(item.quantity_minimum_order);

        let parsedTags = [];
        if (Array.isArray(item.tags)) { parsedTags = [...item.tags]; } 
        else if (typeof item.tags === 'string' && item.tags.trim()) { parsedTags = item.tags.split(',').map(t => t.trim()); }
        activeSelectedEditTags = parsedTags;
        renderActiveTagPills('edit');

        currentEditItemFiles = []; existingItemPhotosToDelete = []; primaryPhotoIdentifier = null;
        const photos = item.photos || [];
        const existingPrimary = photos.find(p => p.is_primary);
        primaryPhotoIdentifier = existingPrimary ? existingPrimary.file_path : (photos.length > 0 ? photos[0].file_path : null);
        
        renderMultipleFilesPreviews('editItemPreviewsRow', currentEditItemFiles, 'edit-item', photos);
        ensureEditItemLayout();
        document.getElementById("itemEditModal").style.display = "flex";
        markModalClean("itemEditModal");
        
    } catch (error) {
        console.error("Critical Error opening edit modal:", error);
    }
}

async function attemptDeleteItem() {
    if (!currentItemForActions || !currentItemForActions.id) return await customAlert("No item selected.", "Error");
    if (!(await customConfirm("Are you sure you want to permanently delete this item? This operation cannot be undone.", "Delete Item?", true))) return;

    const itemName = currentItemForActions.name || "Unknown Item";
    
    // Offline Safe Delete
    const response = await window.offlineSafeWrite('DELETE', 'items', null, currentItemForActions.id);

    if (response.success) {
        closeModal('itemEditModal');
        logAction("DELETE", "Item", itemName, "Permanently removed from database");
        await refreshAllDataFromLocal(); // Instant UI update
        window.processSyncQueue(); // Sync if online
    }
}

async function executeMoveItem() {
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        if (!currentItemForActions || !currentItemForActions.id) return;
        const destinationId = document.getElementById("moveItemLocationSelect").value || null;
        const targetItemId = currentItemForActions.id; 

        // Offline Safe Update
        const response = await window.offlineSafeWrite('UPDATE', 'items', { location_id: destinationId }, targetItemId);
        
        if (response.success) {
            closeModal('moveItemModal'); closeModal('itemDetailsModal'); closeBarcodeScannerModal();
            lastMovedItemId = targetItemId; 
            const destLoc = locationsAdmin.find(l => l.id === destinationId);
            logAction("MOVE", "Item", currentItemForActions.name, `Moved to ${destLoc ? destLoc.name : 'Unallocated'}`);

            await refreshAllDataFromLocal(); // Instant UI update
            window.processSyncQueue(); // Sync if online
            showPage('pageItems'); 
            setTimeout(() => { lastMovedItemId = null; }, 6000);
        }
    } finally { window.isProcessingTransaction = false; }
}

async function saveItemEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!isModalDirty("itemEditModal")) return await showNoChangesDialog("itemEditModal", "item");
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        if (!currentItemForActions || !currentItemForActions.id) return;
        const itemId = currentItemForActions.id;
        const barcode = document.getElementById("editItemBarcode").value;
        const nfc_tag = document.getElementById("editItemNFC").value;

        if (barcode && !(await isHardwareTagUnique(barcode, itemId))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
        if (nfc_tag && !(await isHardwareTagUnique(nfc_tag, itemId))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

        await window.db.from("photos").update({ is_primary: false }).eq("item_id", itemId);
        if (existingItemPhotosToDelete.length > 0) { for (let path of existingItemPhotosToDelete) await window.db.from("photos").delete().eq("file_path", path); }
        if (primaryPhotoIdentifier) await window.db.from("photos").update({ is_primary: true }).eq("file_path", primaryPhotoIdentifier);
        
        if (currentEditItemFiles.length > 0) {
            for (let i = 0; i < currentEditItemFiles.length; i++) {
                const file = currentEditItemFiles[i]; const fileName = `item-${itemId}-${Date.now()}-${i}`;
                const { error: uploadError } = await window.db.storage.from("item-photos").upload(fileName, file);
                if (!uploadError) {
                    const isThisPrimary = file.name === primaryPhotoIdentifier || (!primaryPhotoIdentifier && i === 0 && currentItemForActions.photos.length === 0);
                    await window.db.from("photos").insert([{ item_id: itemId, file_path: fileName, is_primary: isThisPrimary }]);
                }
            }
        }
        // NEW: Dynamically write hyphen string indicator parameter if checkbox toggle is active
        const checkboxIsTool = document.getElementById("editItemIsEquipment")?.checked;
        const compiledQtyValue = checkboxIsTool ? "-" : (parseInt(document.getElementById("editItemQuantity").value) || 0);
        const quantity_minimum_order = normaliseMinimumOrderValue(document.getElementById("editItemMinimumOrder")?.value);

        const payload = {
            name: document.getElementById("editItemName").value, 
            quantity: compiledQtyValue,
            quantity_minimum_order,
            location_id: document.getElementById("editItemLocationSelect").value || null,
            description: document.getElementById("editItemDescription").value,
            barcode, 
            nfc_tag, 
            category: document.getElementById("editItemCategory").value, 
            tags: activeSelectedEditTags
        };
        const { error } = await withStatus(() => window.db.from("items").update(payload).eq("id", itemId), "Updating item...");
        if (!error) {
            closeModal('itemEditModal'); logAction("UPDATE", "Item", payload.name, "Modified item details");
            await syncAfterWrite();
            lastMovedItemId = itemId;
            if (payload.location_id) {
                currentLocationId = payload.location_id;
                await loadLocation(payload.location_id);
            } else {
                currentLocationId = "unallocated";
                await loadUnallocatedItems();
            }
            setTimeout(() => { lastMovedItemId = null; }, 6000);
        }
    } finally { window.isProcessingTransaction = false; }
}

function openMoveItemModal() {
    if (!currentItemForActions) return;
    document.getElementById("moveItemLocationBarcode").value = ""; setLocationSelectValue("moveItemLocationSelect", currentItemForActions.location_id || "");
    document.getElementById("moveItemModal").style.display = "flex";
}

async function executeMoveItem() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to move items.", "Offline Mode");
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        if (!currentItemForActions || !currentItemForActions.id) return;
        const destinationId = document.getElementById("moveItemLocationSelect").value || null;
        const targetItemId = currentItemForActions.id; 

        const { error } = await withStatus(() => window.db.from("items").update({ location_id: destinationId }).eq("id", targetItemId), "Relocating item...");
        if (!error) {
            closeModal('moveItemModal'); closeModal('itemDetailsModal'); closeBarcodeScannerModal();
            lastMovedItemId = targetItemId; const destLoc = locationsAdmin.find(l => l.id === destinationId);
            logAction("MOVE", "Item", currentItemForActions.name, `Moved to ${destLoc ? destLoc.name : 'Unallocated'}`);

            await syncAfterWrite();
            if (destinationId) { currentLocationId = destinationId; await loadLocation(destinationId); } 
            else { currentLocationId = "unallocated"; await loadUnallocatedItems(); }
            showPage('pageItems'); setTimeout(() => { lastMovedItemId = null; }, 6000);
        }
    } finally { window.isProcessingTransaction = false; }
}

/* =========================================================
   LOCATION ACTIONS (CRUD)
========================================================= */
function openAddLocationModal() {
    ["addLocationName", "addLocationDescription", "addLocationBarcode", "addLocationNFC"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const cat = document.getElementById("addLocationCategory"); if (cat) cat.value = "storage";
    document.getElementById("addLocationPhotoInput").value = ""; document.getElementById("addLocationCameraInput").value = ""; document.getElementById("addLocationPreview").src = "../assets/images/folder-icon.jpg";
    currentAddLocationFiles = []; document.getElementById("addLocationModal").style.display = "flex";
    document.getElementById("addLocationModal").style.zIndex = pendingLocationPickerAfterCreate ? "15050" : "";
    markModalClean("addLocationModal");
}

async function addLocation(addAnother = false) {
    const name = document.getElementById("addLocationName").value; 
    const description = document.getElementById("addLocationDescription").value; 
    const barcode = document.getElementById("addLocationBarcode").value; 
    const nfc = document.getElementById("addLocationNFC").value; 
    const category = document.getElementById("addLocationCategory").value;
    
    if (!name) return await customAlert("Please enter a folder name", "Missing Name");
    if (!(await isLocationNameUnique(name))) return await customAlert("A location with that name already exists. Location names must be unique.", "Duplicate Location");
    if (barcode && !(await isHardwareTagUnique(barcode))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
    if (nfc && !(await isHardwareTagUnique(nfc))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

    const payload = { name, location_description: description, barcode, nfc_tag: nfc, category, parent_id: currentLocationAdmin };
    const response = await window.offlineSafeWrite('CREATE', 'locations', payload);

    if (response.success) {
        // Handle Offline Photos
        if (currentAddLocationFiles.length > 0) {
            const file = currentAddLocationFiles[0]; 
            const fileName = `location-${Date.now()}`;
            const base64Data = await window.fileToBase64(file);
            
            await localDB.sync_photos_queue.add({
                record_id: response.id, record_type: 'location', bucket: 'location-photos',
                file_name: fileName, base64_data: base64Data, is_primary: true, status: 'pending'
            });
        }

        logAction("CREATE", "Location", name, "Created new folder"); 
        
        await refreshAllDataFromLocal();
        window.processSyncQueue();
        if (pendingLocationPickerAfterCreate && response.id) {
            loadLocationDropdown();
            const picker = document.getElementById(pendingLocationPickerAfterCreate);
            if (picker) setLocationSelectValue(picker, response.id, true);
            pendingLocationPickerAfterCreate = null;
        }
        if (addAnother) openAddLocationModal();
        else closeModalClean('addLocationModal');
    }
}

function openLocationActions(id) {
    editingLocationId = id; const loc = locationsAdmin.find(l => l.id === id); if (!loc) return;
    document.getElementById("locationActionsName").textContent = loc.name; document.getElementById("editLocationName").value = loc.name || ""; document.getElementById("editLocationDescription").value = loc.location_description || ""; document.getElementById("editLocationBarcode").value = loc.barcode || ""; document.getElementById("editLocationNFC").value = loc.nfc || ""; document.getElementById("editLocationCategory").value = loc.category || "storage";
    currentEditLocationFile = null; window.locationPhotoDeleted = false;
    const previewImg = document.getElementById("editLocationPreview"); if (loc.photo) previewImg.src = window.db.storage.from("location-photos").getPublicUrl(loc.photo).data.publicUrl; else previewImg.src = "../assets/images/folder-icon.jpg";
    document.getElementById("locationActionsModal").style.display = "flex";
    markModalClean("locationActionsModal");
}

async function saveLocationEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!isModalDirty("locationActionsModal")) return await showNoChangesDialog("locationActionsModal", "location");
    if (!editingLocationId) return;
    const barcode = document.getElementById("editLocationBarcode").value; const nfc_tag = document.getElementById("editLocationNFC").value; const name = document.getElementById("editLocationName").value;
    if (!(await isLocationNameUnique(name, editingLocationId))) return await customAlert("A location with that name already exists. Location names must be unique.", "Duplicate Location");
    if (barcode && !(await isHardwareTagUnique(barcode, editingLocationId))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
    if (nfc_tag && !(await isHardwareTagUnique(nfc_tag, editingLocationId))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

    let photoPath = locationsAdmin.find(l => l.id === editingLocationId)?.photo || null;
    if (currentEditLocationFile) {
        const fileName = `location-${Date.now()}`; const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, currentEditLocationFile);
        if (!uploadError) photoPath = fileName;
    } else if (window.locationPhotoDeleted) photoPath = null;

    const payload = { name, description: document.getElementById("editLocationDescription").value, barcode, nfc_tag, category: document.getElementById("editLocationCategory").value, photo_path: photoPath };
    const { error } = await withStatus(() => window.db.from("locations").update(payload).eq("id", editingLocationId), "Saving changes...");
    if (!error) { closeModal('locationActionsModal'); logAction("UPDATE", "Location", name, "Modified folder structure"); await syncAfterWrite(); loadLocationsAdmin(); }
}

async function attemptDeleteLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to delete folders.", "Offline Mode");
    if (!editingLocationId) return;
    const loc = locationsAdmin.find(l => l.id === editingLocationId);
    if (locationsAdmin.some(l => l.parent === editingLocationId)) return await customAlert("Cannot delete: This folder contains sub-folders.", "Folder Not Empty");
    const items = await localDB.items.where('location_id').equals(editingLocationId).toArray();
    if (items && items.length > 0) return await customAlert("Cannot delete: This folder contains items.", "Folder Not Empty");
    
    if (!(await customConfirm("Are you sure? This cannot be undone.", "Delete Folder?", true))) return;

    const { error = null } = await withStatus(() => window.db.from("locations").delete().eq("id", editingLocationId), "Deleting folder...");
    if (!error) { closeModal('locationActionsModal'); logAction("DELETE", "Location", loc ? loc.name : 'Unknown', "Deleted folder"); await syncAfterWrite(); loadLocationsAdmin(); }
}

/* =========================================================
   TEMP LOCATIONS ACTIONS (CRUD)
========================================================= */
function openAddTempLocationModal() {
    document.getElementById("addTempLocationName").value = ""; document.getElementById("addTempLocationDescription").value = ""; document.getElementById("addTempLocationBarcode").value = "";
    document.getElementById("addTempLocationPhotoInput").value = ""; document.getElementById("addTempLocationCameraInput").value = ""; document.getElementById("addTempLocationPreview").src = "../assets/images/folder-icon.jpg";
    currentAddLocationFiles = []; document.getElementById("addTempLocationModal").style.display = "flex";
}

async function addTempLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to create an assignee.", "Offline Mode");
    const name = document.getElementById("addTempLocationName").value; const desc = document.getElementById("addTempLocationDescription").value; const barcode = document.getElementById("addTempLocationBarcode").value;
    if (!name) return await customAlert("Please enter a name for the assignee.", "Missing Name");
    if (barcode && !(await isHardwareTagUnique(barcode))) return await customAlert("That ID code is already in use.", "Duplicate Code");

    let uploadedPhotoPath = null;
    if (currentAddLocationFiles.length > 0) {
        const file = currentAddLocationFiles[0]; const fileName = `temp-loc-${Date.now()}`;
        const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, file);
        if (!uploadError) uploadedPhotoPath = fileName;
    }

    const { error } = await withStatus(() => window.db.from("temp_locations").insert([{ name, description: desc, barcode, photo_path: uploadedPhotoPath }]), "Creating...");
    if (!error) { closeModal('addTempLocationModal'); logAction("CREATE", "Temp Location", name, "Created new assignee profile"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

function openTempLocationActions(id) {
    editingTempLocationId = id; const loc = tempLocationsAdmin.find(l => l.id === id); if (!loc) return;
    document.getElementById("tempLocationActionsName").textContent = loc.name; document.getElementById("editTempLocationName").value = loc.name || ""; document.getElementById("editTempLocationDescription").value = loc.description || ""; document.getElementById("editTempLocationBarcode").value = loc.barcode || "";
    currentEditLocationFile = null; window.locationPhotoDeleted = false;
    const previewImg = document.getElementById("editTempLocationPreview"); if (loc.photo_path) previewImg.src = window.db.storage.from("location-photos").getPublicUrl(loc.photo_path).data.publicUrl; else previewImg.src = "../assets/images/folder-icon.jpg";
    document.getElementById("tempLocationActionsModal").style.display = "flex";
}

async function saveTempLocationEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!editingTempLocationId) return;
    const barcode = document.getElementById("editTempLocationBarcode").value; const name = document.getElementById("editTempLocationName").value;
    if (barcode && !(await isHardwareTagUnique(barcode, editingTempLocationId))) return await customAlert("Barcode in use.", "Duplicate Code");

    let photoPath = tempLocationsAdmin.find(l => l.id === editingTempLocationId)?.photo_path || null;
    if (currentEditLocationFile) {
        const fileName = `temp-loc-${Date.now()}`; const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, currentEditLocationFile);
        if (!uploadError) photoPath = fileName;
    } else if (window.locationPhotoDeleted) photoPath = null;

    const payload = { name, description: document.getElementById("editTempLocationDescription").value, barcode, photo_path: photoPath };
    const { error } = await withStatus(() => window.db.from("temp_locations").update(payload).eq("id", editingTempLocationId), "Saving updates...");
    if (!error) { closeModal('tempLocationActionsModal'); logAction("UPDATE", "Temp Location", name, "Updated assignee details"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

async function attemptDeleteTempLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to delete an assignee.", "Offline Mode");
    if (!editingTempLocationId) return;
    const loc = tempLocationsAdmin.find(t => t.id === editingTempLocationId);
    const items = await localDB.items.where('assigned_to').equals(editingTempLocationId).toArray();
    if (items && items.length > 0) return await customAlert("Cannot delete: Items are currently assigned to this profile.", "Assignee Active");
    if (!(await customConfirm("Delete this Temporary Location?", "Delete Assignee?", true))) return;

    const { error } = await withStatus(() => window.db.from("temp_locations").delete().eq("id", editingTempLocationId), "Deleting...");
    if (!error) { closeModal('tempLocationActionsModal'); logAction("DELETE", "Temp Location", loc.name, "Deleted assignee profile"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

/* =========================================================
   RICH ITEM MODALS: EDITOR INFRASTRUCTURE & STATE ENGINE
========================================================= */


async function switchToItemEdit() {
    if (!currentItemForActions) return;
    closeModal('itemDetailsModal');
    const item = currentItemForActions;

    try {
        if (document.getElementById("editItemName")) document.getElementById("editItemName").value = item.name || "";
        if (document.getElementById("editItemDescription")) document.getElementById("editItemDescription").value = item.description || "";
        if (document.getElementById("editItemCategory")) document.getElementById("editItemCategory").value = item.category || "tools";
        if (document.getElementById("editItemLocationSelect")) setLocationSelectValue("editItemLocationSelect", item.location_id || "");

        // Populate local parameters with row entries data indices
        editModalActiveBarcodeString = item.barcode || "";
        editModalActiveNfcTagString = item.nfc_tag || "";

        // Synchronize display text labels on button targets instantly
        updateEditModalHardwareButtonsUI();

        const isEquipment = (String(item.quantity).trim() === "-");
        const checkbox = document.getElementById("editItemIsEquipment");
        if (checkbox) {
            checkbox.checked = isEquipment;
            handleEquipmentCheckboxToggle(isEquipment);
        }
        
        if (!isEquipment) {
            document.getElementById("editItemQuantity").value = item.quantity || 0;
        }
        const editMinimumOrder = document.getElementById("editItemMinimumOrder");
        if (editMinimumOrder) editMinimumOrder.value = normaliseMinimumOrderValue(item.quantity_minimum_order);

        let parsedTags = [];
        if (Array.isArray(item.tags)) { parsedTags = [...item.tags]; } 
        else if (typeof item.tags === 'string' && item.tags.trim()) { parsedTags = item.tags.split(',').map(t => t.trim()); }
        activeSelectedEditTags = parsedTags;
        renderActiveTagPills('edit');

        currentEditItemFiles = []; existingItemPhotosToDelete = []; primaryPhotoIdentifier = null;
        const photos = item.photos || [];
        const existingPrimary = photos.find(p => p.is_primary);
        primaryPhotoIdentifier = existingPrimary ? existingPrimary.file_path : (photos.length > 0 ? photos[0].file_path : null);
        
        renderMultipleFilesPreviews('editItemPreviewsRow', currentEditItemFiles, 'edit-item', photos);
        ensureEditItemLayout();
        document.getElementById("itemEditModal").style.display = "flex";
        markModalClean("itemEditModal");
        
    } catch (error) {
        console.error("Critical Error opening edit modal:", error);
    }
}

// Synchronize button layouts, text options, and colors dynamically based on variable values
function updateEditModalHardwareButtonsUI() {
    const barBtn = document.getElementById("btnEditModalBarcodeAction");
    const nfcBtn = document.getElementById("btnEditModalNfcAction");
    
    if (barBtn) {
        if (editModalActiveBarcodeString.trim() !== "") {
            barBtn.textContent = `📷 ${editModalActiveBarcodeString}`;
            barBtn.classList.toggle("has-value", true);
            barBtn.style.background = "#e0f2fe";
            barBtn.style.color = "#0369a1";
            barBtn.style.borderColor = "#7dd3fc";
        } else {
            barBtn.textContent = "📷 No Barcode Found";
            barBtn.classList.toggle("has-value", false);
            barBtn.style.background = "#f8fafc";
            barBtn.style.color = "#1e293b";
            barBtn.style.borderColor = "#cbd5e1";
        }
    }
    
    if (nfcBtn) {
        if (editModalActiveNfcTagString.trim() !== "") {
            nfcBtn.textContent = "📡 NFC Tag Assigned";
            nfcBtn.classList.toggle("has-value", true);
            nfcBtn.style.background = "#dcfce7";
            nfcBtn.style.color = "#15803d";
            nfcBtn.style.borderColor = "#86efac";
        } else {
            nfcBtn.textContent = "📡 NFC Ready (Tap)";
            nfcBtn.classList.toggle("has-value", false);
            nfcBtn.style.background = "#f8fafc";
            nfcBtn.style.color = "#1e293b";
            nfcBtn.style.borderColor = "#cbd5e1";
        }
    }
}

// Safely requests permission before overriding barcode data indices
window.triggerEditModalBarcodeAction = async function() {
    if (editModalActiveBarcodeString.trim() !== "") {
        const confirmClear = await customConfirm("Are you sure you want to rewrite or re-scan this barcode reference identity completely?", "Overwrite Barcode?");
        if (!confirmClear) return;
    }
    openBarcodeScannerModal('EDIT_MODAL_BARCODE_INTERNAL_TUNNEL');
};



// Handles numeric boundaries via arrow step controls
function adjustEditModalQty(amount) {
    const isEquipment = document.getElementById("editItemIsEquipment").checked;
    if (isEquipment) return; 
    
    const input = document.getElementById("editItemQuantity");
    let currentVal = parseInt(input.value) || 0;
    let targetVal = currentVal + amount;
    if (targetVal < 0) targetVal = 0;
    input.value = targetVal;
}

// Gray out and lock the quantity selection UI when an item is a tool
function handleEquipmentCheckboxToggle(isChecked) {
    const qtyWrapper = document.getElementById("editItemQtyWrapper");
    const qtyInput = document.getElementById("editItemQuantity");
    const minimumWrapper = document.getElementById("editItemMinimumOrderWrapper");
    const minimumInput = document.getElementById("editItemMinimumOrder");
    const toggle = document.getElementById("editItemEquipmentToggle");
    setToolToggleVisual(toggle, isChecked);
    setNumberControlDisabledState(qtyWrapper, qtyInput, isChecked, "-", "1");
    setNumberControlDisabledState(minimumWrapper, minimumInput, isChecked, "-", "-");
}

async function attemptDeleteItem() {
    if (!currentItemForActions || !currentItemForActions.id) return await customAlert("No item selected.", "Error");
    if (!(await customConfirm("Are you sure you want to permanently delete this item? This operation cannot be undone.", "Delete Item?", true))) return;

    const itemName = currentItemForActions.name || "Unknown Item";
    const response = await window.offlineSafeWrite('DELETE', 'items', null, currentItemForActions.id);

    if (response.success) {
        closeModal('itemEditModal');
        logAction("DELETE", "Item", itemName, "Permanently removed from database");
        await refreshAllDataFromLocal(); 
        window.processSyncQueue(); 
    }
}

async function saveItemEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!isModalDirty("itemEditModal")) return await showNoChangesDialog("itemEditModal", "item");
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        if (!currentItemForActions || !currentItemForActions.id) return;
        const itemId = currentItemForActions.id;

        if (editModalActiveBarcodeString && !(await isHardwareTagUnique(editModalActiveBarcodeString, itemId))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
        if (editModalActiveNfcTagString && !(await isHardwareTagUnique(editModalActiveNfcTagString, itemId))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

        await window.db.from("photos").update({ is_primary: false }).eq("item_id", itemId);
        if (existingItemPhotosToDelete.length > 0) { for (let path of existingItemPhotosToDelete) await window.db.from("photos").delete().eq("file_path", path); }
        if (primaryPhotoIdentifier) await window.db.from("photos").update({ is_primary: true }).eq("file_path", primaryPhotoIdentifier);
        
        if (currentEditItemFiles.length > 0) {
            for (let i = 0; i < currentEditItemFiles.length; i++) {
                const file = currentEditItemFiles[i]; const fileName = `item-${itemId}-${Date.now()}-${i}`;
                const { error: uploadError } = await window.db.storage.from("item-photos").upload(fileName, file);
                if (!uploadError) {
                    const isThisPrimary = file.name === primaryPhotoIdentifier || (!primaryPhotoIdentifier && i === 0 && currentItemForActions.photos.length === 0);
                    await window.db.from("photos").insert([{ item_id: itemId, file_path: fileName, is_primary: isThisPrimary }]);
                }
            }
        }
        
        const checkboxIsTool = document.getElementById("editItemIsEquipment")?.checked;
        const compiledQtyValue = checkboxIsTool ? "-" : (parseInt(document.getElementById("editItemQuantity").value) || 0);
        const quantity_minimum_order = normaliseMinimumOrderValue(document.getElementById("editItemMinimumOrder")?.value);

        const payload = {
            name: document.getElementById("editItemName").value, 
            quantity: compiledQtyValue,
            quantity_minimum_order,
            location_id: document.getElementById("editItemLocationSelect").value || null,
            description: document.getElementById("editItemDescription").value,
            barcode: editModalActiveBarcodeString, 
            nfc_tag: editModalActiveNfcTagString, 
            category: document.getElementById("editItemCategory").value,
            tags: activeSelectedEditTags
        };
        
        const { error } = await withStatus(() => window.db.from("items").update(payload).eq("id", itemId), "Updating item...");
        if (!error) {
            closeModal('itemEditModal'); logAction("UPDATE", "Item", payload.name, "Modified item details");
            await syncAfterWrite();
            if (currentTempLocationId) await loadTempLocationDetails(currentTempLocationId); else if (currentLocationId === "unallocated") await loadUnallocatedItems();
            else if (currentLocationId) await loadLocation(currentLocationId); else await loadRootLocations();
        }
    } finally { window.isProcessingTransaction = false; }
}

// Intercept original scanner callback channels to hook hardware values into the modal elements
if (typeof openBarcodeScannerModal === "function") {
    const baseScannerLauncher = openBarcodeScannerModal;
    openBarcodeScannerModal = function(targetId) {
        if (targetId === 'EDIT_MODAL_BARCODE_INTERNAL_TUNNEL') {
            window.activeBarcodeTargetInputId = 'EDIT_MODAL_BARCODE_INTERNAL_TUNNEL';
            document.getElementById("barcodeScannerModal").style.display = "flex";
            isProcessingScan = false;
            html5QrcodeScannerInstance = new Html5Qrcode("scannerReaderContainer");
            const lensConfig = (typeof determineActiveTargetLens === 'function') ? determineActiveTargetLens() : { facingMode: "environment" };
            
            html5QrcodeScannerInstance.start(lensConfig, { fps: 15, qrbox: { width: 260, height: 160 } },
                (decodedText) => {
                    if (isProcessingScan) return; isProcessingScan = true;
                    editModalActiveBarcodeString = decodedText;
                    updateEditModalHardwareButtonsUI();
                    closeBarcodeScannerModal();
                }, () => {}
            ).then(() => {
                if (typeof applyHardwareZoomToContainer === 'function') applyHardwareZoomToContainer("scannerReaderContainer");
            }).catch(() => {});
            return;
        }
        return baseScannerLauncher(targetId);
    };
}

// Hook peripheral readings straight into variables
if (typeof openNfcScannerModal === "function") {
    const baseNfcLauncher = openNfcScannerModal;
    openNfcScannerModal = function(targetId) {
        if (document.getElementById("itemEditModal").style.display === "flex" && !targetId) {
            if (editModalActiveNfcTagString.trim() !== "") {
                triggerEditModalNfcClearanceRequest(); return;
            }
            window.activeNfcTargetInputId = "EDIT_MODAL_NFC_INTERNAL_TUNNEL";
            document.getElementById("nfcScannerModal").style.display = "flex";
            isProcessingNfcScan = false;
            try {
                const ndef = new NDEFReader(); nfcAbortController = new AbortController();
                ndef.scan({ signal: nfcAbortController.signal }).then(() => {
                    ndef.onreading = (event) => {
                        if (isProcessingNfcScan) return; isProcessingNfcScan = true;
                        editModalActiveNfcTagString = event.serialNumber;
                        updateEditModalHardwareButtonsUI();
                        closeNfcScannerModal();
                    };
                }).catch(() => closeNfcScannerModal());
            } catch(e) { closeNfcScannerModal(); }
            return;
        }
        return baseNfcLauncher(targetId);
    };
}

/* =========================================================
   ASYNC BATCH WORKFLOW OPERATIONS AND UTILITY LAYOUTS
========================================================= */
function openMoveItemModal() {
    if (!currentItemForActions) return;
    document.getElementById("moveItemLocationBarcode").value = ""; setLocationSelectValue("moveItemLocationSelect", currentItemForActions.location_id || "");
    document.getElementById("moveItemModal").style.display = "flex";
}

async function executeMoveItem() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to move items.", "Offline Mode");
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        if (!currentItemForActions || !currentItemForActions.id) return;
        const destinationId = document.getElementById("moveItemLocationSelect").value || null;
        const targetItemId = currentItemForActions.id; 

        const { error } = await withStatus(() => window.db.from("items").update({ location_id: destinationId }).eq("id", targetItemId), "Relocating item...");
        if (!error) {
            closeModal('moveItemModal'); closeModal('itemDetailsModal'); closeBarcodeScannerModal();
            lastMovedItemId = targetItemId; const destLoc = locationsAdmin.find(l => l.id === destinationId);
            logAction("MOVE", "Item", currentItemForActions.name, `Moved to ${destLoc ? destLoc.name : 'Unallocated'}`);

            await syncAfterWrite();
            if (destinationId) { currentLocationId = destinationId; await loadLocation(destinationId); } 
            else { currentLocationId = "unallocated"; await loadUnallocatedItems(); }
            showPage('pageItems'); setTimeout(() => { lastMovedItemId = null; }, 6000);
        }
    } finally { window.isProcessingTransaction = false; }
}

function openAddLocationModal() {
    ["addLocationName", "addLocationDescription", "addLocationBarcode", "addLocationNFC"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const cat = document.getElementById("addLocationCategory"); if (cat) cat.value = "storage";
    document.getElementById("addLocationPhotoInput").value = ""; document.getElementById("addLocationCameraInput").value = ""; document.getElementById("addLocationPreview").src = "../assets/images/folder-icon.jpg";
    currentAddLocationFiles = []; document.getElementById("addLocationModal").style.display = "flex";
    document.getElementById("addLocationModal").style.zIndex = pendingLocationPickerAfterCreate ? "15050" : "";
    markModalClean("addLocationModal");
}

async function addLocation(addAnother = false) {
    const name = document.getElementById("addLocationName").value; 
    const description = document.getElementById("addLocationDescription").value; 
    const barcode = document.getElementById("addLocationBarcode").value; 
    const nfc = document.getElementById("addLocationNFC").value; 
    const category = document.getElementById("addLocationCategory").value;
    
    if (!name) return await customAlert("Please enter a folder name", "Missing Name");
    if (!(await isLocationNameUnique(name))) return await customAlert("A location with that name already exists. Location names must be unique.", "Duplicate Location");
    if (barcode && !(await isHardwareTagUnique(barcode))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
    if (nfc && !(await isHardwareTagUnique(nfc))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

    const payload = { name, description: description, barcode, nfc_tag: nfc, category, parent_id: currentLocationAdmin };
    const response = await window.offlineSafeWrite('CREATE', 'locations', payload);

    if (response.success) {
        if (currentAddLocationFiles.length > 0) {
            const file = currentAddLocationFiles[0]; 
            const fileName = `location-${Date.now()}`;
            const base64Data = await window.fileToBase64(file);
            
            await localDB.sync_photos_queue.add({
                record_id: response.id, record_type: 'location', bucket: 'location-photos',
                file_name: fileName, base64_data: base64Data, is_primary: true, status: 'pending'
            });
        }

        logAction("CREATE", "Location", name, "Created new folder"); 
        await refreshAllDataFromLocal();
        window.processSyncQueue();
        if (pendingLocationPickerAfterCreate && response.id) {
            loadLocationDropdown();
            const picker = document.getElementById(pendingLocationPickerAfterCreate);
            if (picker) setLocationSelectValue(picker, response.id, true);
            pendingLocationPickerAfterCreate = null;
        }
        if (addAnother) openAddLocationModal();
        else closeModalClean('addLocationModal');
    }
}

function openLocationActions(id) {
    editingLocationId = id; const loc = locationsAdmin.find(l => l.id === id); if (!loc) return;
    document.getElementById("locationActionsName").textContent = loc.name; document.getElementById("editLocationName").value = loc.name || ""; document.getElementById("editLocationDescription").value = loc.location_description || ""; document.getElementById("editLocationBarcode").value = loc.barcode || ""; document.getElementById("editLocationNFC").value = loc.nfc || ""; document.getElementById("editLocationCategory").value = loc.category || "storage";
    currentEditLocationFile = null; window.locationPhotoDeleted = false;
    const previewImg = document.getElementById("editLocationPreview"); if (loc.photo) previewImg.src = window.db.storage.from("location-photos").getPublicUrl(loc.photo).data.publicUrl; else previewImg.src = "../assets/images/folder-icon.jpg";
    document.getElementById("locationActionsModal").style.display = "flex";
    markModalClean("locationActionsModal");
}

async function saveLocationEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!isModalDirty("locationActionsModal")) return await showNoChangesDialog("locationActionsModal", "location");
    if (!editingLocationId) return;
    const barcode = document.getElementById("editLocationBarcode").value; const nfc_tag = document.getElementById("editLocationNFC").value; const name = document.getElementById("editLocationName").value;
    if (!(await isLocationNameUnique(name, editingLocationId))) return await customAlert("A location with that name already exists. Location names must be unique.", "Duplicate Location");
    if (barcode && !(await isHardwareTagUnique(barcode, editingLocationId))) return await customAlert("Barcode ID is already registered!", "Duplicate Code");
    if (nfc_tag && !(await isHardwareTagUnique(nfc_tag, editingLocationId))) return await customAlert("NFC Tag is already registered!", "Duplicate Code");

    let photoPath = locationsAdmin.find(l => l.id === editingLocationId)?.photo || null;
    if (currentEditLocationFile) {
        const fileName = `location-${Date.now()}`; const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, currentEditLocationFile);
        if (!uploadError) photoPath = fileName;
    } else if (window.locationPhotoDeleted) photoPath = null;

    const payload = { name, description: document.getElementById("editLocationDescription").value, barcode, nfc_tag, category: document.getElementById("editLocationCategory").value, photo_path: photoPath };
    const { error } = await withStatus(() => window.db.from("locations").update(payload).eq("id", editingLocationId), "Saving changes...");
    if (!error) { closeModal('locationActionsModal'); logAction("UPDATE", "Location", name, "Modified folder structure"); await syncAfterWrite(); loadLocationsAdmin(); }
}

async function attemptDeleteLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to delete folders.", "Offline Mode");
    if (!editingLocationId) return;
    const loc = locationsAdmin.find(l => l.id === editingLocationId);
    if (locationsAdmin.some(l => l.parent === editingLocationId)) return await customAlert("Cannot delete: This folder contains sub-folders.", "Folder Not Empty");
    const items = await localDB.items.where('location_id').equals(editingLocationId).toArray();
    if (items && items.length > 0) return await customAlert("Cannot delete: This folder contains items.", "Folder Not Empty");
    if (!(await customConfirm("Are you sure? This cannot be undone.", "Delete Folder?", true))) return;

    const { error = null } = await withStatus(() => window.db.from("locations").delete().eq("id", editingLocationId), "Deleting folder...");
    if (!error) { closeModal('locationActionsModal'); logAction("DELETE", "Location", loc ? loc.name : 'Unknown', "Deleted folder"); await syncAfterWrite(); loadLocationsAdmin(); }
}

function openAddTempLocationModal() {
    document.getElementById("addTempLocationName").value = ""; document.getElementById("addTempLocationDescription").value = ""; document.getElementById("addTempLocationBarcode").value = "";
    document.getElementById("addTempLocationPhotoInput").value = ""; document.getElementById("addTempLocationCameraInput").value = ""; document.getElementById("addTempLocationPreview").src = "../assets/images/folder-icon.jpg";
    currentAddLocationFiles = []; document.getElementById("addTempLocationModal").style.display = "flex";
}

async function addTempLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to create an assignee.", "Offline Mode");
    const name = document.getElementById("addTempLocationName").value; const desc = document.getElementById("addTempLocationDescription").value; const barcode = document.getElementById("addTempLocationBarcode").value;
    if (!name) return await customAlert("Please enter a name for the assignee.", "Missing Name");
    if (barcode && !(await isHardwareTagUnique(barcode))) return await customAlert("That ID code is already in use.", "Duplicate Code");

    let uploadedPhotoPath = null;
    if (currentAddLocationFiles.length > 0) {
        const file = currentAddLocationFiles[0]; const fileName = `temp-loc-${Date.now()}`;
        const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, file);
        if (!uploadError) uploadedPhotoPath = fileName;
    }

    const { error } = await withStatus(() => window.db.from("temp_locations").insert([{ name, description: desc, barcode, photo_path: uploadedPhotoPath }]), "Creating...");
    if (!error) { closeModal('addTempLocationModal'); logAction("CREATE", "Temp Location", name, "Created new assignee profile"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

function openTempLocationActions(id) {
    editingTempLocationId = id; const loc = tempLocationsAdmin.find(l => l.id === id); if (!loc) return;
    document.getElementById("tempLocationActionsName").textContent = loc.name; document.getElementById("editTempLocationName").value = loc.name || ""; document.getElementById("editTempLocationDescription").value = loc.description || ""; document.getElementById("editTempLocationBarcode").value = loc.barcode || "";
    currentEditLocationFile = null; window.locationPhotoDeleted = false;
    const previewImg = document.getElementById("editTempLocationPreview"); if (loc.photo_path) previewImg.src = window.db.storage.from("location-photos").getPublicUrl(loc.photo_path).data.publicUrl; else previewImg.src = "../assets/images/folder-icon.jpg";
    document.getElementById("tempLocationActionsModal").style.display = "flex";
}

async function saveTempLocationEdits() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to save edits.", "Offline Mode");
    if (!editingTempLocationId) return;
    const barcode = document.getElementById("editTempLocationBarcode").value; const name = document.getElementById("editTempLocationName").value;
    if (barcode && !(await isHardwareTagUnique(barcode, editingTempLocationId))) return await customAlert("Barcode in use.", "Duplicate Code");

    let photoPath = tempLocationsAdmin.find(l => l.id === editingTempLocationId)?.photo_path || null;
    if (currentEditLocationFile) {
        const fileName = `temp-loc-${Date.now()}`; const { error: uploadError } = await window.db.storage.from("location-photos").upload(fileName, currentEditLocationFile);
        if (!uploadError) photoPath = fileName;
    } else if (window.locationPhotoDeleted) photoPath = null;

    const payload = { name, description: document.getElementById("editTempLocationDescription").value, barcode, photo_path: photoPath };
    const { error } = await withStatus(() => window.db.from("temp_locations").update(payload).eq("id", editingTempLocationId), "Saving updates...");
    if (!error) { closeModal('tempLocationActionsModal'); logAction("UPDATE", "Temp Location", name, "Updated assignee details"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

async function attemptDeleteTempLocation() {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to delete an assignee.", "Offline Mode");
    if (!editingTempLocationId) return;
    const loc = tempLocationsAdmin.find(t => t.id === editingTempLocationId);
    const items = await localDB.items.where('assigned_to').equals(editingTempLocationId).toArray();
    if (items && items.length > 0) return await customAlert("Cannot delete: Items are currently assigned to this profile.", "Assignee Active");
    if (!(await customConfirm("Delete this Temporary Location?", "Delete Assignee?", true))) return;

    const { error } = await withStatus(() => window.db.from("temp_locations").delete().eq("id", editingTempLocationId), "Deleting...");
    if (!error) { closeModal('tempLocationActionsModal'); logAction("DELETE", "Temp Location", loc.name, "Deleted assignee profile"); await syncAfterWrite(); loadTempLocationsAdmin(); }
}

function openLightbox() { if (!lightboxImages || lightboxImages.length === 0) return; document.getElementById("review-lightbox").style.display = "flex"; updateLightboxUI(); }
function closeLightbox() { document.getElementById("review-lightbox").style.display = "none"; }
function changeLightboxImage(direction) { lightboxIndex += direction; if (lightboxIndex < 0) lightboxIndex = lightboxImages.length - 1; if (lightboxIndex >= lightboxImages.length) lightboxIndex = 0; updateLightboxUI(); }
function updateLightboxUI() { const imgEl = document.getElementById("lightbox-img"); const counterEl = document.getElementById("lightbox-counter"); if (imgEl && lightboxImages[lightboxIndex]) imgEl.src = lightboxImages[lightboxIndex]; if (counterEl) counterEl.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`; }

// --- UPGRADED ITEM ASSIGNMENT & MERGE ENGINE ---
function handleAssignReturnToggle() {
    if (!currentItemForActions) return;
    
    if (currentItemForActions.assigned_to) {
        // Route to the dedicated Return Modal we built previously
        executeReturnItem(currentItemForActions.id);
    } else {
        // Prepare the Assignment Modal
        document.getElementById("assignModalItemName").textContent = currentItemForActions.name;
        
        const isEquipment = (String(currentItemForActions.quantity).trim() === "-");
        const qtyWrapper = document.getElementById("assignModalQtyWrapper");
        const qtyInput = document.getElementById("assignModalQtyValue");
        const maxQtyLabel = document.getElementById("assignModalMaxQty");

        if (isEquipment) {
            maxQtyLabel.textContent = "Equipment Asset (1 Unit)";
            qtyInput.value = "-";
            qtyInput.disabled = true;
            qtyWrapper.style.opacity = "0.5";
            qtyWrapper.style.pointerEvents = "none";
        } else {
            maxQtyLabel.textContent = currentItemForActions.quantity + " Available";
            qtyInput.value = 1;
            qtyInput.disabled = false;
            qtyWrapper.style.opacity = "1";
            qtyWrapper.style.pointerEvents = "auto";
        }

        document.getElementById("assignItemSelect").value = ""; 
        document.getElementById("assignItemModal").style.display = "flex"; 
    }
}

function changeAssignModalQty(amount) {
    if (!currentItemForActions) return;
    const isEquipment = (String(currentItemForActions.quantity).trim() === "-");
    if (isEquipment) return;

    const input = document.getElementById("assignModalQtyValue");
    const max = parseInt(currentItemForActions.quantity) || 1;
    let val = parseInt(input.value) || 1;
    val += amount;
    if (val < 1) val = 1;
    if (val > max) val = max;
    input.value = val;
}

async function executeAssignItem() {
    if (!currentItemForActions) return;
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        const targetId = document.getElementById("assignItemSelect").value;
        if (!targetId) return await customAlert("Please select a valid assignee profile.", "Missing Target");
        const tempLoc = tempLocationsAdmin.find(t => t.id === targetId);

        const item = currentItemForActions;
        const isEquipment = (String(item.quantity).trim() === "-");
        const qtyToAssign = isEquipment ? 1 : (parseInt(document.getElementById("assignModalQtyValue").value) || 1);
        const originalQty = parseInt(item.quantity) || 0;
        
        const allItems = await localDB.items.toArray();

        // 1. Subtract or delete from the master warehouse record
        if (isEquipment || originalQty - qtyToAssign <= 0) {
            await window.offlineSafeWrite('DELETE', 'items', null, item.id);
        } else {
            await window.offlineSafeWrite('UPDATE', 'items', { quantity: originalQty - qtyToAssign }, item.id);
        }

        // 2. Identify if Assignee already holds this specific stock
        const existingAssigneeRow = allItems.find(i => {
            if (String(i.assigned_to || '') !== String(targetId)) return false;
            if (String(i.location_id || '') !== String(item.location_id || '')) return false;
            if (i.barcode && item.barcode && i.barcode.trim().toLowerCase() === item.barcode.trim().toLowerCase()) return true;
            if (i.nfc_tag && item.nfc_tag && i.nfc_tag.trim().toLowerCase() === item.nfc_tag.trim().toLowerCase()) return true;
            return i.name.trim().toLowerCase() === item.name.trim().toLowerCase();
        });

        // 3. Merge or Create a new Assigned Row
        if (existingAssigneeRow && !isEquipment) {
            const currentAssigneeQty = parseInt(existingAssigneeRow.quantity) || 0;
            await window.offlineSafeWrite('UPDATE', 'items', { quantity: currentAssigneeQty + qtyToAssign }, existingAssigneeRow.id);
        } else {
            const newId = crypto.randomUUID();
            const newAssigneeRow = {
                ...item, id: newId, quantity: isEquipment ? "-" : qtyToAssign, assigned_to: targetId
            };
            const databasePayload = { ...newAssigneeRow };
            delete databasePayload.photos; // Photos map via relation

            await localDB.items.put(newAssigneeRow);
            await localDB.sync_queue.add({ action: 'CREATE', table: 'items', payload: databasePayload, record_id: newId, created_at: new Date().toISOString(), status: 'pending' });

            if (item.photos && item.photos.length > 0) {
                for (let p of item.photos) {
                    await localDB.sync_queue.add({
                        action: 'CREATE', table: 'photos', payload: { item_id: newId, file_path: p.file_path, is_primary: p.is_primary }, record_id: null, created_at: new Date().toISOString(), status: 'pending'
                    });
                }
            }
        }

        logAction("CHECKOUT", "Item", item.name, `Assigned ${isEquipment ? 'Equipment' : (qtyToAssign + ' unit(s)')} to ${tempLoc ? tempLoc.name : 'User'}`);
        
        closeModal("assignItemModal"); 
        closeModal("itemDetailsModal"); 
        lastMovedItemId = item.id; 
        
        await refreshAllDataFromLocal(); 
        window.processSyncQueue(); 
        setTimeout(() => { lastMovedItemId = null; }, 6000);
        await customAlert(`🎉 Success! <b>[${item.name}]</b> has been assigned to <b>${tempLoc ? tempLoc.name : 'User'}</b>.`, "Assignment Complete");

    } finally {
        window.isProcessingTransaction = false;
    }
}

// --- UPGRADED ITEM RETURN & MERGE ENGINE ---
let currentReturnItemContext = null;

async function executeReturnItem(itemId, fromTempView = false) {
    const allItems = await localDB.items.toArray();
    const itemData = allItems.find(i => i.id === itemId) || currentItemForActions;
    if (!itemData || !itemData.assigned_to) return;

    currentReturnItemContext = { item: itemData, fromTempView };

    // 1. Populate Modal UI
    document.getElementById("returnModalItemName").textContent = itemData.name;
    const tempLoc = tempLocationsAdmin.find(t => t.id === itemData.assigned_to);
    document.getElementById("returnModalAssigneeName").textContent = tempLoc ? tempLoc.name : 'Unknown';
    
    const isEquipment = (String(itemData.quantity).trim() === "-");
    const qtyWrapper = document.getElementById("returnModalQtyWrapper");
    const qtyInput = document.getElementById("returnModalQtyValue");
    const maxQtyLabel = document.getElementById("returnModalMaxQty");

    // Protect Equipment Assets from Quantity Adjustments
    if (isEquipment) {
        maxQtyLabel.textContent = "Equipment Asset (1 Unit)";
        qtyInput.value = "-";
        qtyInput.disabled = true;
        qtyWrapper.style.opacity = "0.5";
        qtyWrapper.style.pointerEvents = "none";
    } else {
        maxQtyLabel.textContent = itemData.quantity + " Available";
        qtyInput.value = 1;
        qtyInput.disabled = false;
        qtyWrapper.style.opacity = "1";
        qtyWrapper.style.pointerEvents = "auto";
    }

    // 2. Map "Use Items" Jump Action
    document.getElementById("returnModalUseBtn").onclick = () => {
        closeModal('itemReturnModal');
        closeModal('itemDetailsModal');
        showPage('pageTempLocations');
        loadTempLocationDetails(itemData.assigned_to);
        // Automatically switch into Stock Consumption Mode upon arrival
        setTimeout(() => {
            if (!isStockUsageModeActive) toggleStockUsageMode();
        }, 300);
    };

    document.getElementById("itemReturnModal").style.display = "flex";
}

function changeReturnModalQty(amount) {
    if (!currentReturnItemContext) return;
    const isEquipment = (String(currentReturnItemContext.item.quantity).trim() === "-");
    if (isEquipment) return;

    const input = document.getElementById("returnModalQtyValue");
    const max = parseInt(currentReturnItemContext.item.quantity) || 1;
    let val = parseInt(input.value) || 1;
    val += amount;
    if (val < 1) val = 1;
    if (val > max) val = max;
    input.value = val;
}

async function confirmProcessItemReturn() {
    if (!currentReturnItemContext) return;
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        const loanItem = currentReturnItemContext.item;
        const isEquipment = (String(loanItem.quantity).trim() === "-");
        const qtyToReturn = isEquipment ? 1 : (parseInt(document.getElementById("returnModalQtyValue").value) || 1);
        
        const currentLoanQty = parseInt(loanItem.quantity) || 0;
        const newLoanQty = currentLoanQty - qtyToReturn;

        const allItems = await localDB.items.toArray();

        // 1. Locate Original Warehouse Item (Strict Matching prevents duplicates)
        const warehouseRow = allItems.find(i => {
            const assigned = String(i.assigned_to || '').trim().toLowerCase();
            if (assigned !== '' && assigned !== 'null' && assigned !== 'undefined') return false;
            if (String(i.location_id || '') !== String(loanItem.location_id || '')) return false;
            if (i.barcode && loanItem.barcode && i.barcode.trim().toLowerCase() === loanItem.barcode.trim().toLowerCase()) return true;
            if (i.nfc_tag && loanItem.nfc_tag && i.nfc_tag.trim().toLowerCase() === loanItem.nfc_tag.trim().toLowerCase()) return true;
            return i.name.trim().toLowerCase() === loanItem.name.trim().toLowerCase();
        });

        // 2. Mutate Assignee Loan Row
        if (isEquipment || newLoanQty <= 0) {
            await window.offlineSafeWrite('DELETE', 'items', null, loanItem.id);
        } else {
            await window.offlineSafeWrite('UPDATE', 'items', { quantity: newLoanQty }, loanItem.id);
        }

        // 3. Mutate or Generate Warehouse Row
        if (warehouseRow) {
            if (!isEquipment) {
                const currentWhQty = parseInt(warehouseRow.quantity) || 0;
                await window.offlineSafeWrite('UPDATE', 'items', { quantity: currentWhQty + qtyToReturn }, warehouseRow.id);
            }
        } else {
            // Re-create the master record if the warehouse pool was completely depleted
            const newId = crypto.randomUUID();
            const restoredRow = {
                ...loanItem, id: newId, quantity: isEquipment ? "-" : qtyToReturn, assigned_to: null
            };
            delete restoredRow.photos; 
            
            await localDB.items.put(restoredRow);
            await localDB.sync_queue.add({ action: 'CREATE', table: 'items', payload: restoredRow, record_id: newId, created_at: new Date().toISOString(), status: 'pending' });

            // Automatically clone physical photos over to the new master record
            if (loanItem.photos && loanItem.photos.length > 0) {
                for (let p of loanItem.photos) {
                    await localDB.sync_queue.add({
                        action: 'CREATE', table: 'photos', payload: { item_id: newId, file_path: p.file_path, is_primary: p.is_primary }, record_id: null, created_at: new Date().toISOString(), status: 'pending'
                    });
                }
            }
        }

        // 4. Register Transaction Log
        const assigneeName = document.getElementById("returnModalAssigneeName").textContent;
        logAction("RETURN", "Item", loanItem.name, `Returned ${isEquipment ? 'Equipment' : (qtyToReturn + ' unit(s)')} from ${assigneeName} to stock.`);

        closeModal('itemReturnModal');
        closeModal('itemDetailsModal');
        lastMovedItemId = warehouseRow ? warehouseRow.id : loanItem.id;
        
        await refreshAllDataFromLocal();
        window.processSyncQueue();
        
        if (currentReturnItemContext.fromTempView) {
            await loadTempLocationDetails(currentTempLocationId || currentReturnItemContext.fromTempView);
        }
        
        setTimeout(() => { lastMovedItemId = null; }, 6000);
        await customAlert(`🎉 Success! <b>[${loanItem.name}]</b> has been checked back into stock.`, "Return Complete");

    } finally { window.isProcessingTransaction = false; }
}

function handleAssignBarcodeLookup(scannedText) {
    if (!scannedText || !tempLocationsAdmin) return;
    const cleanToken = scannedText.trim().toLowerCase();
    const match = tempLocationsAdmin.find(t => (t.barcode && t.barcode.trim().toLowerCase() === cleanToken) || (t.nfc_tag && t.nfc_tag.trim().toLowerCase() === cleanToken));
    if (match) { document.getElementById("assignItemSelect").value = match.id; executeAssignItem(); }
}

async function executeFastReturnLookup(scannedCodeString) {
    if (!scannedCodeString || !scannedCodeString.trim()) return;
    const lowerToken = scannedCodeString.trim().toLowerCase();
    const items = await localDB.items.toArray(); 
    if (!items) return;

    const match = items.find(item => (item.barcode && item.barcode.trim().toLowerCase() === lowerToken) || (item.nfc_tag && item.nfc_tag.trim().toLowerCase() === lowerToken));
    if (!match) return await customAlert(`No items found matching that tag!`, "Scan Failed");
    if (!match.assigned_to) return await customAlert(`Item <b>[${match.name}]</b> is already in the warehouse (Not checked out).`, "Already In Stock");

    const response = await window.offlineSafeWrite('UPDATE', 'items', { assigned_to: null }, match.id);
    if (response.success) {
        const locPath = match.location_id ? buildLocationPath(match.location_id) : "Unallocated Items";
        const successMsg = `🎉 Success! <b>[${match.name}]</b> has been checked back in.<br><br><b>📍 PLEASE RETURN TO:</b><br><span style="color: #004a99; font-weight: bold; font-size: 16px;">${locPath}</span>`;
        await customAlert(successMsg, "Item Returned");
        lastMovedItemId = match.id; 
        logAction("RETURN", "Item", match.name, "Fast-Return via Scanner");
        await refreshAllDataFromLocal();
        window.processSyncQueue(); 
        if (currentTempLocationId) loadTempLocationDetails(currentTempLocationId);
        else if (currentLocationId) loadLocation(currentLocationId);
        else loadRootLocations();
        setTimeout(() => { lastMovedItemId = null; }, 6000);
    }
}

async function handleGlobalSearch(term) {
    const filterType = document.getElementById("searchTypeFilter")?.value || "all";
    const lowerTerm = term.toLowerCase().trim();
    activeSearchEmptyTerm = lowerTerm ? term.trim() : "";
    if (!lowerTerm && activeSearchTags.length === 0 && !activeSearchCategory) { activeSearchEmptyTerm = ""; if (currentLocationId) loadLocation(currentLocationId); else loadRootLocations(); return; }
    document.getElementById("breadcrumb").innerHTML = `Filtered Search Grid View`;

    const items = await localDB.items.toArray(); 
    if (!items) return;
    const sections = { name: [], location: [], tag: [], category: [] };

    items.forEach(item => {
        const nameMatches = item.name?.toLowerCase().includes(lowerTerm);
        const locationPath = item.location_id ? buildLocationPath(item.location_id).toLowerCase() : "unallocated items";
        const locationMatches = locationPath.includes(lowerTerm);
        const barcodeMatches = (item.barcode && item.barcode.toLowerCase().includes(lowerTerm)) || (item.nfc_tag && item.nfc_tag.toLowerCase().includes(lowerTerm));

        let itemTagsArray = [];
        if (Array.isArray(item.tags)) itemTagsArray = item.tags; else if (typeof item.tags === 'string' && item.tags.trim()) itemTagsArray = item.tags.split(',').map(t => t.trim());
        const itemTagsLower = itemTagsArray.map(t => t.toLowerCase());

        let tagPillsMatch = true; if (filterType === "tag" && activeSearchTags.length > 0) tagPillsMatch = activeSearchTags.every(t => itemTagsLower.includes(t.toLowerCase()));
        let textTagMatch = lowerTerm ? itemTagsArray.some(t => t.toLowerCase().includes(lowerTerm)) : true;
        let catPillMatch = true; if (filterType === "category" && activeSearchCategory) catPillMatch = item.category?.toLowerCase() === activeSearchCategory.toLowerCase();
        let textCatMatch = lowerTerm ? item.category?.toLowerCase().includes(lowerTerm) : true;

        if (filterType === "all") {
            if (nameMatches) sections.name.push(item); if (locationMatches) sections.location.push(item);
            if (lowerTerm && itemTagsArray.some(t => t.toLowerCase().includes(lowerTerm))) sections.tag.push(item);
            if (item.category?.toLowerCase().includes(lowerTerm)) sections.category.push(item);
        } else if (filterType === "name" && nameMatches) sections.name.push(item); else if (filterType === "location" && locationMatches) sections.location.push(item); else if (filterType === "barcode" && barcodeMatches) sections.name.push(item); else if (filterType === "tag" && tagPillsMatch && textTagMatch) sections.tag.push(item); else if (filterType === "category" && catPillMatch && textCatMatch) sections.category.push(item);
    });
    renderSectionedSearchResults(sections, filterType);
}

function renderSectionedSearchResults(sections, filterType) {
    let combinedResults = [];
    if (filterType === "all") {
        combinedResults = [...sections.name, ...sections.location, ...sections.tag, ...sections.category];
    } else if (filterType === "name" || filterType === "barcode") {
        combinedResults = [...sections.name];
    } else if (filterType === "location") {
        combinedResults = [...sections.location];
    } else if (filterType === "tag") {
        combinedResults = [...sections.tag];
    } else if (filterType === "category") {
        combinedResults = [...sections.category];
    }

    const uniqueResults = Array.from(new Set(combinedResults.map(i => i.id)))
        .map(id => combinedResults.find(i => i.id === id));

    currentBrowserLocations = []; 
    currentBrowserItems = uniqueResults;
    renderLocations([]); 
    renderItems(uniqueResults);
}

function handleLocationBarcodeLookup(scannedText) {
    if (!scannedText || !locationsAdmin) return;
    const match = findLocationByScanToken(scannedText);
    if (match) { setLocationSelectValue("moveItemLocationSelect", match.id, true); executeMoveItem(); }
}

function handleSearchFilterTypeChange() {
    const filterType = document.getElementById("searchTypeFilter").value; const pillsRow = document.getElementById("searchFilterPillsRow"); const searchInput = document.getElementById("globalSearchInput");
    activeSearchTags = []; activeSearchCategory = null; 
    if (filterType === "tag" || filterType === "category") { pillsRow.style.display = "flex"; renderSearchFilterPills(filterType); } else { pillsRow.style.display = "none"; pillsRow.innerHTML = ""; } 
    handleGlobalSearch(searchInput.value); 
}

function renderSearchFilterPills(filterType) {
    const pillsRow = document.getElementById("searchFilterPillsRow"); if (!pillsRow) return; pillsRow.innerHTML = "";
    if (filterType === "tag") {
        globalCachedTags.forEach(tag => {
            const pill = document.createElement("span"); pill.className = "tag-pill"; const isActive = activeSearchTags.includes(tag.name);
            pill.style.cssText = "cursor: pointer; user-select: none; transition: all 0.15s ease; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;";
            if (isActive) { pill.style.background = "#004a99"; pill.style.color = "#ffffff"; pill.style.borderColor = "#004a99"; pill.textContent = `✓ ${tag.name}`; } else { pill.style.background = "#f1f5f9"; pill.style.color = "#475569"; pill.style.borderColor = "#e2e8f0"; pill.textContent = `🏷️ ${tag.name}`; }
            pill.onclick = () => { 
    if (activeSearchTags.includes(tag.name)) {
        // If it's already selected, clicking it again deselects it (clears the array)
        activeSearchTags = []; 
    } else {
        // EXCLUSIVE SELECT: Overwrite the array to ONLY contain the clicked tag
        activeSearchTags = [tag.name]; 
    } 
    
    // Re-render the UI and trigger the search
    renderSearchFilterPills("tag"); 
    handleGlobalSearch(document.getElementById("globalSearchInput").value); 
}; pillsRow.appendChild(pill);
        });
    } else if (filterType === "category") {
        globalCachedCategories.forEach(cat => {
            const pill = document.createElement("span"); pill.className = "tag-pill"; const isActive = activeSearchCategory === cat.name;
            pill.style.cssText = "cursor: pointer; user-select: none; transition: all 0.15s ease; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;";
            if (isActive) { pill.style.background = "#ff8c00"; pill.style.color = "#ffffff"; pill.style.borderColor = "#ff8c00"; pill.textContent = `✓ ${cat.name}`; } else { pill.style.background = "#f1f5f9"; pill.style.color = "#475569"; pill.style.borderColor = "#e2e8f0"; pill.textContent = `📁 ${cat.name}`; }
            pill.onclick = () => { if (activeSearchCategory === cat.name) activeSearchCategory = null; else activeSearchCategory = cat.name; renderSearchFilterPills("category"); handleGlobalSearch(document.getElementById("globalSearchInput").value); }; pillsRow.appendChild(pill);
        });
    }
}

function clickSearchTag(tagName) {
    if (!tagName) return; closeModal('itemDetailsModal'); showPage('pageItems'); 
    const filterSelect = document.getElementById("searchTypeFilter"); if (filterSelect) filterSelect.value = "tag";
    const pillsRow = document.getElementById("searchFilterPillsRow"); if (pillsRow) pillsRow.style.display = "flex";
    activeSearchTags = [tagName]; document.getElementById("globalSearchInput").value = ""; renderSearchFilterPills("tag"); handleGlobalSearch("");
}

function handleTagSelection(mode, tagName) {
    if (!tagName) return; const targetArray = mode === 'add' ? activeSelectedAddTags : activeSelectedEditTags;
    if (!targetArray.includes(tagName)) { targetArray.push(tagName); renderActiveTagPills(mode); }
    document.getElementById(mode === 'add' ? "itemTagSelect" : "editItemTagSelect").value = "";
}

function removeSelectedTagBadge(mode, tagName) {
    if (mode === 'add') activeSelectedAddTags = activeSelectedAddTags.filter(t => t !== tagName); else activeSelectedEditTags = activeSelectedEditTags.filter(t => t !== tagName);
    renderActiveTagPills(mode);
}

function renderActiveTagPills(mode) {
    const container = document.getElementById(mode === 'add' ? "addItemTagsPillsRow" : "editItemTagsPillsRow"); const targetArray = mode === 'add' ? activeSelectedAddTags : activeSelectedEditTags;
    container.innerHTML = "";
    targetArray.forEach(tag => {
        const pill = document.createElement("span"); pill.className = "tag-pill"; pill.style.cssText = "display:inline-flex; align-items:center; gap:6px; background:#e0f2fe; border-color:#bae6fd; color:#0369a1;";
        pill.innerHTML = `${tag} <b style="cursor:pointer; color:#ef4444;">&times;</b>`; pill.querySelector("b").onclick = () => removeSelectedTagBadge(mode, tag); container.appendChild(pill);
    });
}

async function loadTagsAdmin() {
    const data = await localDB.tags.orderBy('name').toArray();
    const tbody = document.getElementById("centralTagsTableBody"); tbody.innerHTML = "";
    if(!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#999; font-style:italic; padding:20px;">No tags in registry</td></tr>`; return; }
    data.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td style="font-weight:600; color:#333;">${t.name}</td><td style="text-align:right; padding-right:15px;"><button class="btn-outline" style="padding:4px 10px; font-size:12px; margin-right:6px;" onclick="openTagModal(false, '${t.id}', '${t.name}')">Edit</button><button class="btn-danger" style="padding:4px 10px; font-size:12px;" onclick="deleteCentralTag('${t.id}')">Delete</button></td>`; 
        tbody.appendChild(tr);
    });
}

async function loadCategoriesAdmin() {
    const data = await localDB.item_categories.orderBy('name').toArray();
    const tbody = document.getElementById("centralCategoriesTableBody"); tbody.innerHTML = "";
    if(!data || data.length === 0) { tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:#999; font-style:italic; padding:20px;">No categories in registry</td></tr>`; return; }
    data.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td style="font-weight:600; color:#333;">${c.name}</td><td style="text-align:right; padding-right:15px;"><button class="btn-outline" style="padding:4px 10px; font-size:12px; margin-right:6px;" onclick="openCategoryModal(false, '${c.id}', '${c.name}')">Edit</button><button class="btn-danger" style="padding:4px 10px; font-size:12px;" onclick="deleteCentralCategory('${c.id}')">Delete</button></td>`; 
        tbody.appendChild(tr);
    });
}

function openTagModal(isSubCall = false, id = null, name = '') { isSubModalContextCall = isSubCall; editingTagTargetId = id; document.getElementById("tagModalTitle").textContent = id ? "Modify Tag Name" : "Add New Tag Label"; document.getElementById("tagModalInput").value = name; document.getElementById("centralTagModal").style.display = "flex"; }

async function saveCentralTag() { 
    const name = document.getElementById("tagModalInput").value.trim(); 
    if (!name) return await customAlert("Please enter a tag label designation.", "Missing Label"); 
    const existing = globalCachedTags.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing && existing.id !== editingTagTargetId) return await customAlert("Tag already exists.", "Duplicate Error");

    let response;
    if (editingTagTargetId) {
        response = await window.offlineSafeWrite('UPDATE', 'tags', { name }, editingTagTargetId);
    } else {
        response = await window.offlineSafeWrite('CREATE', 'tags', { name });
    }
    
    if (!response.error) { 
        closeModal('centralTagModal'); 
        logAction("CREATE/UPDATE", "Tag", name, "Modified system tag"); 
        await refreshAllDataFromLocal(); 
        if (isSubModalContextCall) { 
            const currentActiveMode = document.getElementById("itemEditModal").style.display === 'flex' ? 'edit' : 'add'; 
            handleTagSelection(currentActiveMode, name); 
        } else { 
            loadTagsAdmin(); 
        } 
    } 
}

async function deleteCentralTag(id) { 
    const tag = globalCachedTags.find(t => t.id === id);
    if (!(await customConfirm("Are you sure? Removing this tag will strip it from any item that uses it.", "Delete Tag?", true))) return; 
    const { error } = await window.offlineSafeWrite('DELETE', 'tags', null, id);
    if (!error) { 
        logAction("DELETE", "Tag", tag ? tag.name : "Unknown", "Removed system tag"); 
        await refreshAllDataFromLocal(); 
        loadTagsAdmin(); 
    } 
}

function openCategoryModal(isSubCall = false, id = null, name = '') { isSubModalContextCall = isSubCall; editingCategoryTargetId = id; document.getElementById("categoryModalTitle").textContent = id ? "Modify Category Classification" : "Add New Item Category"; document.getElementById("categoryModalInput").value = name; document.getElementById("centralCategoryModal").style.display = "flex"; }

async function saveCentralCategory() { 
    const name = document.getElementById("categoryModalInput").value.trim(); 
    if (!name) return await customAlert("Please specify classification name parameter.", "Missing Name"); 
    const existing = globalCachedCategories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing && existing.id !== editingCategoryTargetId) return await customAlert("Category already exists.", "Duplicate Error");

    let response; 
    if (editingCategoryTargetId) {
        response = await window.offlineSafeWrite('UPDATE', 'item_categories', { name }, editingCategoryTargetId); 
    } else {
        response = await window.offlineSafeWrite('CREATE', 'item_categories', { name }); 
    }
    
    if (!response.error) { 
        closeModal('centralCategoryModal'); 
        logAction("CREATE/UPDATE", "Category", name, "Modified classification"); 
        await refreshAllDataFromLocal(); 
        if (isSubModalContextCall) { 
            const targetSelId = document.getElementById("itemEditModal").style.display === 'flex' ? "editItemCategory" : "itemCategorySelect"; 
            document.getElementById(targetSelId).value = name; 
        } else { 
            loadCategoriesAdmin(); 
        } 
    } 
}

async function deleteCentralCategory(id) { 
    const cat = globalCachedCategories.find(c => c.id === id);
    if (!(await customConfirm("Are you sure you want to drop this classification option?", "Delete Category?", true))) return; 
    const { error } = await window.offlineSafeWrite('DELETE', 'item_categories', null, id); 
    if (!error) { 
        logAction("DELETE", "Category", cat ? cat.name : "Unknown", "Removed category"); 
        await refreshAllDataFromLocal(); 
        loadCategoriesAdmin(); 
    } 
}

currentQtyAdjusterItem = null;

function openQuantityAdjusterModal() {
    currentQtyAdjusterItem = null;
    document.getElementById("qtyAdjusterScanPrompt").style.display = "block"; document.getElementById("qtyAdjusterActiveItem").style.display = "none"; document.getElementById("qtyAdjusterManualBarcode").value = "";
    document.getElementById("quantityAdjusterModal").style.display = "flex";
    openBarcodeScannerModal('FAST_QTY_ADJUST');
}

async function handleQuantityAdjusterLookup(scannedCodeString) {
    if (!scannedCodeString || !scannedCodeString.trim()) return;
    const lowerToken = scannedCodeString.trim().toLowerCase();
    
    const items = await localDB.items.toArray();
    if (!items) return await customAlert("Failed to fetch database.", "Error");

    const match = items.find(item => (item.barcode && item.barcode.trim().toLowerCase() === lowerToken) || (item.nfc_tag && item.nfc_tag.trim().toLowerCase() === lowerToken));
    if (!match) {
        await customAlert(`No inventory item found matching code: [${scannedCodeString}]`, "Item Not Found");
        document.getElementById("qtyAdjusterScanPrompt").style.display = "block"; document.getElementById("qtyAdjusterActiveItem").style.display = "none"; return;
    }

    currentQtyAdjusterItem = match;
    document.getElementById("qtyAdjusterItemName").textContent = match.name; document.getElementById("qtyAdjusterItemBarcode").textContent = match.barcode || match.nfc_tag || "N/A"; document.getElementById("qtyAdjusterValue").value = match.quantity || 0;
    
    document.getElementById("qtyAdjusterScanPrompt").style.display = "none"; document.getElementById("qtyAdjusterActiveItem").style.display = "block";
}

function changeAdjusterQty(amount) {
    const input = document.getElementById("qtyAdjusterValue"); let currentVal = parseInt(input.value) || 0;
    let newVal = currentVal + amount; if (newVal < 0) newVal = 0; input.value = newVal;
}

async function saveQuantityAdjustment(closeAfter) {
    if (!window.isAppOnline) return await customAlert("You must be connected to the internet to adjust quantities.", "Offline Mode");
    if (!currentQtyAdjusterItem) return;
    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    const newQty = parseInt(document.getElementById("qtyAdjusterValue").value) || 0;
    try {
        const { error } = await withStatus(() => window.db.from("items").update({ quantity: newQty }).eq("id", currentQtyAdjusterItem.id), "Updating quantity...");
        if (!error) {
            logAction("UPDATE", "Item", currentQtyAdjusterItem.name, `Quantity adjusted: ${currentQtyAdjusterItem.quantity} -> ${newQty} (Fast Adjuster)`);
            await syncAfterWrite();
            if (currentLocationId) await loadLocation(currentLocationId); else await loadRootLocations();

            if (closeAfter) { closeModal('quantityAdjusterModal'); } else { openQuantityAdjusterModal(); }
        }
    } finally { window.isProcessingTransaction = false; }
}

/* =========================================================
   UNIFIED HARDWARE SCANNER (BARCODE + NFC + LIVE ZOOM)
========================================================= */
let unifiedNfcAbortController = null;
let html5QrcodeScannerInstance = null;
let isProcessingUnifiedScan = false;

window.openBarcodeScannerModal = async function(targetInputId = null) {
    // 1. Clean up any previous instances
    if (html5QrcodeScannerInstance) {
        try { await html5QrcodeScannerInstance.stop(); html5QrcodeScannerInstance.clear(); } catch(e) {}
        html5QrcodeScannerInstance = null;
    }
    if (unifiedNfcAbortController) { 
        unifiedNfcAbortController.abort(); 
        unifiedNfcAbortController = null; 
    }

    document.getElementById("barcodeScannerModal").style.display = "flex"; 
    window.activeBarcodeTargetInputId = targetInputId; // Kept for legacy compatibility
    isProcessingUnifiedScan = false;

    const cancelBtn = document.getElementById("barcodeScannerCancelBtn");
    if (cancelBtn) {
        cancelBtn.textContent = targetInputId === "FAST_QTY_ADJUST" ? "Cancel adjustment" : "Close scanner";
    }
    
    const container = document.getElementById("scannerReaderContainer");
    container.innerHTML = "";
    container.style.display = "block";
    container.style.height = "260px"; 
    
    // 2. DYNAMIC UI INJECTION (NFC Banner & Live Zoom Slider)
    let uiWrapper = document.getElementById("unifiedScannerUI");
    if (!uiWrapper) {
        uiWrapper = document.createElement("div");
        uiWrapper.id = "unifiedScannerUI";
        uiWrapper.style.marginTop = "15px";
        uiWrapper.style.display = "flex";
        uiWrapper.style.flexDirection = "column";
        uiWrapper.style.gap = "10px";
        container.parentElement.appendChild(uiWrapper);
    }

    const defaultZoom = userSettings.defaultZoom || 1.5;
    
    uiWrapper.innerHTML = `
        <div id="nfcStatusDisplay" style="padding: 10px; border-radius: 8px; font-weight: bold; font-size: 13px; text-align: center; background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; transition: all 0.3s ease;">
            ⏳ Initializing NFC...
        </div>
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; color: #475569; margin-bottom: 8px;">
                <span>Live Camera Zoom (Temporary)</span>
                <span id="liveZoomValDisplay">${defaultZoom}x</span>
            </div>
            <input type="range" id="liveZoomSlider" min="1.0" max="4.0" step="0.1" value="${defaultZoom}" 
                   oninput="applyDynamicZoom(this.value)" style="width: 100%; accent-color: #004a99;">
        </div>
    `;

    // 3. START NFC BACKGROUND ENGINE
    const nfcStatusDiv = document.getElementById("nfcStatusDisplay");
    if ("NDEFReader" in window && window.isSecureContext) {
        nfcStatusDiv.innerHTML = "📡 NFC Active: Ready to scan";
        nfcStatusDiv.style.color = "#15803d";
        nfcStatusDiv.style.background = "#dcfce7";
        nfcStatusDiv.style.borderColor = "#bbf7d0";
        try {
            unifiedNfcAbortController = new AbortController();
            const ndef = new NDEFReader();
            await ndef.scan({ signal: unifiedNfcAbortController.signal });
            ndef.onreading = (event) => {
                if (isProcessingUnifiedScan) return; 
                isProcessingUnifiedScan = true;
                executeUnifiedScannerRouting(getNfcTextFromEvent(event), targetInputId);
            };
        } catch (err) {
            nfcStatusDiv.innerHTML = "⚠️ NFC Error: Please check device settings.";
            nfcStatusDiv.style.color = "#b91c1c";
            nfcStatusDiv.style.background = "#fee2e2";
            nfcStatusDiv.style.borderColor = "#fecaca";
        }
    } else {
        nfcStatusDiv.innerHTML = "⚠️ NFC Unavailable (Requires HTTPS & Compatible Device)";
        nfcStatusDiv.style.color = "#9a3412";
        nfcStatusDiv.style.background = "#ffedd5";
        nfcStatusDiv.style.borderColor = "#fed7aa";
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    // 4. START OPTICAL CAMERA ENGINE
    html5QrcodeScannerInstance = new Html5Qrcode("scannerReaderContainer");
    const lensConfig = (typeof determineActiveTargetLens === 'function') ? await determineActiveTargetLens() : { facingMode: "environment" };

    html5QrcodeScannerInstance.start(
        lensConfig, 
        { fps: 15, qrbox: { width: 260, height: 160 }, aspectRatio: 1.333333 },
        (decodedText) => {
            if (isProcessingUnifiedScan) return; 
            isProcessingUnifiedScan = true; 
            executeUnifiedScannerRouting(decodedText.trim(), targetInputId);
        }, 
        () => {}
    ).then(() => {
        // Automatically apply the default zoom setting when the camera boots
        if (typeof applyDynamicZoom === 'function') applyDynamicZoom(defaultZoom);
    }).catch(err => {
        console.error("Camera Init Error:", err);
    });
};

// --- DYNAMIC ZOOM (Does NOT overwrite Master Settings) ---
window.applyDynamicZoom = function(val) {
    const display = document.getElementById('liveZoomValDisplay');
    if (display) display.textContent = val + 'x';

    const container = document.getElementById("scannerReaderContainer");
    if (!container) return;
    const videoEl = container.querySelector("video");
    if (videoEl && videoEl.srcObject) {
        const track = videoEl.srcObject.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === "function") {
            const caps = track.getCapabilities();
            if ("zoom" in caps) {
                let target = parseFloat(val);
                if (target < caps.zoom.min) target = caps.zoom.min;
                if (target > caps.zoom.max) target = caps.zoom.max;
                track.applyConstraints({ advanced: [{ zoom: target }] }).catch(()=>{});
            }
        }
    }
};

// --- THE MASTER ROUTER (Handles both Barcode & NFC perfectly) ---
window.executeUnifiedScannerRouting = async function(scannedToken, targetInputId) {
    const cleanToken = scannedToken.trim();
    const lowerToken = cleanToken.toLowerCase();
    closeBarcodeScannerModal();

    console.log("🚨 UNIFIED ROUTER TRIGGERED! Target ID is:", targetInputId, "| Scanned Code:", cleanToken);

    if (targetInputId === 'FAST_RETURN') { 
        executeFastReturnLookup(cleanToken); 

    } else if (targetInputId === 'FAST_QTY_ADJUST') { 
        handleQuantityAdjusterLookup(cleanToken); 

    } else if (targetInputId === 'EDIT_MODAL_BARCODE_INTERNAL_TUNNEL' || targetInputId === 'EDIT_MODAL_NFC_INTERNAL_TUNNEL') {
        // Smart Routing: If it has colons, it's an NFC tag. Otherwise, Barcode.
        if (cleanToken.includes(':')) {
            editModalActiveNfcTagString = cleanToken;
        } else {
            editModalActiveBarcodeString = cleanToken;
        }
        updateEditModalHardwareButtonsUI();

    } else if (targetInputId === 'assignItemBarcodeTunnel' || targetInputId === 'assignItemNfcTunnel') {
        const match = tempLocationsAdmin.find(t => (t.barcode && t.barcode.trim().toLowerCase() === lowerToken) || (t.nfc_tag && t.nfc_tag.trim().toLowerCase() === lowerToken));
        if (match) { document.getElementById("assignItemSelect").value = match.id; }
        else { customAlert("No assignee profile found matching that tag.", "Not Found"); }

    } else if (targetInputId === 'itemLocationSelect' || targetInputId === 'addItemLocationTunnel') {
        const match = findLocationByScanToken(cleanToken);
        if (match) { 
            window.updateLocationDropdownUI("itemLocationSelect", match); 
        } else { 
            customAlert("No location folder found matching that tag.", "Not Found"); 
        }

    } else if (targetInputId === 'editItemLocationSelect') {
        const match = findLocationByScanToken(cleanToken);
        if (match) { window.updateLocationDropdownUI("editItemLocationSelect", match); } 
        else { customAlert("No location folder found matching that tag.", "Not Found"); }

    } else if (targetInputId) {
        // Fallback for raw input fields
        const targetEl = document.getElementById(targetInputId);
        if (targetEl) targetEl.value = cleanToken;

        if (targetInputId === 'addItemBarcode' || targetInputId === 'addItemNFC') updateAddItemHardwareButtonsUI();
        if (targetInputId === 'moveItemLocationBarcode') handleLocationBarcodeLookup(cleanToken);
        if (targetInputId === 'assignItemBarcode') handleAssignBarcodeLookup(cleanToken);

    } else { 
        await routeGlobalHardwareScan(cleanToken);
    }
};

function closeBarcodeScannerModal() { 
    document.getElementById("barcodeScannerModal").style.display = "none"; 
    
    // Kill Camera
    if (html5QrcodeScannerInstance) { 
        html5QrcodeScannerInstance.stop().then(() => { 
            html5QrcodeScannerInstance = null; 
            document.getElementById("scannerReaderContainer").innerHTML = ""; 
            isProcessingUnifiedScan = false; 
        }).catch(err => { 
            html5QrcodeScannerInstance = null; 
            isProcessingUnifiedScan = false; 
        }); 
    }
    
    // Kill NFC
    if (unifiedNfcAbortController) { 
        unifiedNfcAbortController.abort(); 
        unifiedNfcAbortController = null; 
    } 
}

window.cancelBarcodeScannerModal = function() {
    const activeTarget = window.activeBarcodeTargetInputId;
    closeBarcodeScannerModal();
    if (activeTarget === "FAST_QTY_ADJUST") {
        closeModal("quantityAdjusterModal");
    }
};

// Dummy close function for legacy NFC buttons that haven't been deleted yet
window.closeNfcScannerModal = function() { closeBarcodeScannerModal(); };
window.openNfcScannerModal = function(target) { openBarcodeScannerModal(target); };




function initFabScrollFade() {
    window.addEventListener('scroll', () => {
        if (window.innerWidth > 768) return;
        const fabContainer = document.getElementById("mobileFabContainer");
        if (!fabContainer) return;
        const scrollPosition = window.scrollY + window.innerHeight;
        const bottomPosition = document.documentElement.scrollHeight;
        if (scrollPosition >= bottomPosition - 30) fabContainer.classList.remove('fab-faded');
        else fabContainer.classList.remove('fab-faded');
    }, { passive: true });
}

/* =========================================================
   ASYNC SMART ENGINE: BATCH-COMPATIBLE WORKFLOW STACKS
========================================================= */

// --- STATE CONTAINERS ---
let qaScannerInstance = null, qmScannerInstance = null, qrScannerInstance = null;
let qaNfcAbort = null, qmNfcAbort = null, qrNfcAbort = null;
let qaCurrentStep = 1, qmCurrentStep = 1; 
let qaIsProcessing = false, qmIsProcessing = false, qrIsProcessing = false;

let qaBatchMode = false, qmBatchMode = false, qrBatchMode = false;
let qaQueue = [], qmQueue = [], qrQueue = []; 

let globalCamerasList = [];
let currentCameraIndex = 0;

let isStockUsageModeActive = false;
let stockUsageDraft = new Map();

function setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
}

function resetQuickQueue(prefix) {
    const queueMap = { qa: qaQueue, qm: qmQueue, qr: qrQueue };
    queueMap[prefix].length = 0;
    const count = document.getElementById(`${prefix}QueueCount`);
    const list = document.getElementById(`${prefix}QueueList`);
    const proceed = document.getElementById(prefix === 'qr' ? 'qrProceedBatchBtn' : `${prefix}ProceedBatchBtn`);
    if (count) count.textContent = "0";
    if (list) list.innerHTML = "";
    if (proceed) proceed.disabled = true;
}

function setBatchMode(prefix, checked) {
    const batchMap = { qa: 'qaBatchQueueContainer', qm: 'qmBatchQueueContainer', qr: 'qrBatchQueueContainer' };
    if (prefix === 'qa') qaBatchMode = checked;
    if (prefix === 'qm') qmBatchMode = checked;
    if (prefix === 'qr') qrBatchMode = checked;
    setDisplay(batchMap[prefix], checked ? 'block' : 'none');
    if (!checked) resetQuickQueue(prefix);
}

function toggleQaBatchMode(checked) { setBatchMode('qa', checked); }
function toggleQmBatchMode(checked) { setBatchMode('qm', checked); }
function toggleQrBatchMode(checked) { setBatchMode('qr', checked); }
function clearQaQueue() { resetQuickQueue('qa'); }
function clearQmQueue() { resetQuickQueue('qm'); }
function clearQrQueue() { resetQuickQueue('qr'); }

function adjustInlineQty(prefix, amount) {
    const input = document.getElementById(`${prefix}InlineQtyInput`);
    if (!input) return;
    const max = parseInt(input.max, 10);
    let value = (parseInt(input.value, 10) || 1) + amount;
    if (value < 1) value = 1;
    if (!Number.isNaN(max) && value > max) value = max;
    input.value = value;
}

let quickQtyDraft = { qa: null, qm: null, qr: null };

function isEquipmentAsset(item) { return String(item?.quantity).trim() === "-"; }
function getQuickMaxQty(item) { return isEquipmentAsset(item) ? 1 : Math.max(1, parseInt(item?.quantity, 10) || 1); }
function getQuickQueue(prefix) { return prefix === "qa" ? qaQueue : prefix === "qm" ? qmQueue : qrQueue; }
function getQuickQtyFromEntry(entry) { return Math.max(1, parseInt(entry?._quickQty, 10) || getQuickMaxQty(entry)); }

function updateQuickBatchButton(prefix, active) {
    const btn = document.getElementById(`${prefix}BatchToggle`);
    if (!btn) return;
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.textContent = active ? "Scanning Multiple Items" : "Scan Multiple Items";
    btn.style.background = active ? "#004a99" : "#f1f5f9";
    btn.style.color = active ? "#ffffff" : "#334155";
    btn.style.borderColor = active ? "#004a99" : "#cbd5e1";
}

function setQuickBatchToggleVisible(prefix, visible) {
    const btn = document.getElementById(`${prefix}BatchToggle`);
    if (btn?.parentElement) btn.parentElement.style.display = visible ? "flex" : "none";
}

function setQuickScannerVisible(prefix, visible) {
    const scanner = document.getElementById(`${prefix}ScannerReader`);
    if (scanner?.parentElement) scanner.parentElement.style.display = visible ? "block" : "none";
}

function setQuickQtyControls(prefix, item) {
    quickQtyDraft[prefix] = item;
    const section = document.getElementById(`${prefix}QtyPickerSection`);
    const input = document.getElementById(`${prefix}InlineQtyInput`);
    const label = document.getElementById(`${prefix}QtyMaxLabel`);
    if (!section || !input || !label) return;
    const max = getQuickMaxQty(item);
    input.min = 1;
    input.max = max;
    input.value = max;
    input.disabled = isEquipmentAsset(item);
    label.innerHTML = isEquipmentAsset(item) ? `<b>${item.name}</b><br>Equipment Asset (1 Unit)` : `<b>${item.name}</b><br>${max} available. Defaulting to maximum.`;
    section.style.display = "block";
    setQuickScannerVisible(prefix, false);
    setQuickBatchToggleVisible(prefix, false);
}

function hideQuickQtyControls(prefix) {
    quickQtyDraft[prefix] = null;
    const section = document.getElementById(`${prefix}QtyPickerSection`);
    if (section) section.style.display = "none";
}

function prepareQuickQueueEntry(item, qty) {
    return { ...item, _quickQty: isEquipmentAsset(item) ? 1 : Math.min(getQuickMaxQty(item), Math.max(1, parseInt(qty, 10) || 1)) };
}

function addQuickQueueItem(prefix, item, qty = getQuickMaxQty(item)) {
    const queue = getQuickQueue(prefix);
    const entry = prepareQuickQueueEntry(item, qty);
    const existingIndex = queue.findIndex(q => q.id === entry.id);
    if (existingIndex >= 0) queue[existingIndex] = entry;
    else queue.push(entry);
    return entry;
}

function updateQuickQueueQty(prefix, itemId, qty) {
    const entry = getQuickQueue(prefix).find(q => q.id === itemId);
    if (!entry) return;
    entry._quickQty = Math.min(getQuickMaxQty(entry), Math.max(1, parseInt(qty, 10) || 1));
    if (prefix === "qa") window.renderQaQueueUI();
    if (prefix === "qm") window.renderQmQueueUI();
    if (prefix === "qr") window.renderQrQueueUI();
}

window.adjustQueuedQuickQty = function(prefix, itemId, amount) {
    const entry = getQuickQueue(prefix).find(q => q.id === itemId);
    if (!entry) return;
    updateQuickQueueQty(prefix, itemId, getQuickQtyFromEntry(entry) + amount);
};

function stripQuickRuntimeFields(row) {
    const clean = { ...row };
    delete clean._quickQty;
    delete clean.photos;
    return clean;
}

function renderQuickQueuePill(prefix, item, idx, colorStyles, removeCallback) {
    const span = document.createElement("span");
    span.className = "tag-pill";
    span.style.cssText = `${colorStyles} font-size:11px; display:inline-flex; align-items:center; gap:6px;`;
    const name = document.createElement("span");
    name.textContent = item.name;
    span.appendChild(name);
    const editable = prefix === "qr" || (prefix === "qa" && qaCurrentStep === 2) || (prefix === "qm" && qmCurrentStep === 2);
    if (editable) {
        const qtyWrap = document.createElement("span");
        qtyWrap.style.cssText = "display:inline-flex; align-items:center; gap:3px; background:rgba(255,255,255,0.75); border-radius:999px; padding:2px 4px;";
        const minus = document.createElement("button");
        minus.type = "button"; minus.textContent = "-"; minus.style.cssText = "border:0; background:transparent; font-weight:900; cursor:pointer; padding:0 3px;";
        minus.onclick = () => window.adjustQueuedQuickQty(prefix, item.id, -1);
        const qty = document.createElement("input");
        qty.type = "number"; qty.min = "1"; qty.max = String(getQuickMaxQty(item)); qty.value = String(getQuickQtyFromEntry(item));
        qty.style.cssText = "width:42px; height:22px; border:1px solid #cbd5e1; border-radius:6px; text-align:center; font-size:12px; font-weight:800; margin:0;";
        qty.onchange = () => updateQuickQueueQty(prefix, item.id, qty.value);
        const plus = document.createElement("button");
        plus.type = "button"; plus.textContent = "+"; plus.style.cssText = "border:0; background:transparent; font-weight:900; cursor:pointer; padding:0 3px;";
        plus.onclick = () => window.adjustQueuedQuickQty(prefix, item.id, 1);
        qtyWrap.append(minus, qty, plus);
        span.appendChild(qtyWrap);
    } else {
        const qtyText = document.createElement("small");
        qtyText.style.fontWeight = "800";
        qtyText.textContent = `x${getQuickQtyFromEntry(item)}`;
        span.appendChild(qtyText);
    }
    const remove = document.createElement("b");
    remove.innerHTML = "&times;";
    remove.style.cssText = "color:#ef4444; cursor:pointer;";
    remove.onclick = () => removeCallback(idx);
    span.appendChild(remove);
    return span;
}

function findMatchingInventoryRow(items, sourceItem, assignedTo, locationId = sourceItem.location_id) {
    return items.find(i => {
        const assigned = String(i.assigned_to || "").trim();
        const targetAssigned = String(assignedTo || "").trim();
        if (assigned !== targetAssigned) return false;
        if (String(i.location_id || "") !== String(locationId || "")) return false;
        if (i.id === sourceItem.id) return false;
        if (i.barcode && sourceItem.barcode && i.barcode.trim().toLowerCase() === sourceItem.barcode.trim().toLowerCase()) return true;
        if (i.nfc_tag && sourceItem.nfc_tag && i.nfc_tag.trim().toLowerCase() === sourceItem.nfc_tag.trim().toLowerCase()) return true;
        return String(i.name || "").trim().toLowerCase() === String(sourceItem.name || "").trim().toLowerCase();
    });
}

async function createClonedItemRow(sourceItem, overrides) {
    const newId = crypto.randomUUID();
    const newRow = stripQuickRuntimeFields({ ...sourceItem, ...overrides, id: newId });
    const payload = stripQuickRuntimeFields(newRow);
    await localDB.items.put(newRow);
    await localDB.sync_queue.add({ action: "CREATE", table: "items", payload, record_id: newId, created_at: new Date().toISOString(), status: "pending" });
    if (sourceItem.photos && sourceItem.photos.length > 0) {
        for (let p of sourceItem.photos) {
            await localDB.sync_queue.add({ action: "CREATE", table: "photos", payload: { item_id: newId, file_path: p.file_path, is_primary: p.is_primary }, record_id: null, created_at: new Date().toISOString(), status: "pending" });
        }
    }
    return newRow;
}

async function moveQuantityBetweenRows(sourceItem, qty, targetAssignedTo, targetLocationId) {
    const isEquipment = isEquipmentAsset(sourceItem);
    const qtyToMove = isEquipment ? 1 : Math.min(getQuickMaxQty(sourceItem), Math.max(1, parseInt(qty, 10) || 1));
    const originalQty = parseInt(sourceItem.quantity, 10) || 0;
    const allItems = await localDB.items.toArray();
    const targetRow = findMatchingInventoryRow(allItems, sourceItem, targetAssignedTo, targetLocationId);
    if (isEquipment || originalQty - qtyToMove <= 0) await window.offlineSafeWrite("DELETE", "items", null, sourceItem.id);
    else await window.offlineSafeWrite("UPDATE", "items", { quantity: originalQty - qtyToMove }, sourceItem.id);
    if (targetRow && !isEquipment) {
        const targetQty = parseInt(targetRow.quantity, 10) || 0;
        await window.offlineSafeWrite("UPDATE", "items", { quantity: targetQty + qtyToMove }, targetRow.id);
    } else {
        await createClonedItemRow(sourceItem, { quantity: isEquipment ? "-" : qtyToMove, assigned_to: targetAssignedTo || null, location_id: targetLocationId || null });
    }
    return qtyToMove;
}

function setupQuickQtyHoldControls() {
    ["qa", "qm", "qr"].forEach(prefix => {
        const input = document.getElementById(`${prefix}InlineQtyInput`);
        const section = document.getElementById(`${prefix}QtyPickerSection`);
        if (!input || !section || section.dataset.holdReady === "true") return;
        section.dataset.holdReady = "true";
        section.querySelectorAll("button").forEach(btn => {
            const clickAttr = btn.getAttribute("onclick") || "";
            if (!clickAttr.includes("adjustInlineQty")) return;
            let timer = null;
            const isMinus = clickAttr.includes("-1");
            const clear = () => { if (timer) clearTimeout(timer); timer = null; };
            btn.addEventListener("pointerdown", () => {
                clear();
                timer = setTimeout(() => { input.value = isMinus ? 1 : (parseInt(input.max, 10) || 1); timer = null; }, 450);
            });
            btn.addEventListener("pointerup", clear);
            btn.addEventListener("pointerleave", clear);
            btn.addEventListener("pointercancel", clear);
        });
    });
}

window.confirmQuickItemQuantity = function(prefix) {
    const item = quickQtyDraft[prefix];
    if (!item) return;
    const input = document.getElementById(`${prefix}InlineQtyInput`);
    addQuickQueueItem(prefix, item, input ? input.value : getQuickMaxQty(item));
    hideQuickQtyControls(prefix);
    if (prefix === "qa") { window.renderQaQueueUI(); qaBatchMode ? (qaIsProcessing = false, window.triggerQaSplash("Item Added!")) : (window.proceedQaToStep2(), qaIsProcessing = false); }
    if (prefix === "qm") { window.renderQmQueueUI(); qmBatchMode ? (qmIsProcessing = false, window.triggerQmSplash("Item Added!")) : (window.proceedQmToStep2(), qmIsProcessing = false); }
    if (prefix === "qr") { window.renderQrQueueUI(); qrBatchMode ? (qrIsProcessing = false, window.triggerQrSplash("Item Added!")) : window.executeBatchReturn(); }
};

window.openQuickAssignModal = async function() {
    window.closeFab?.();
    document.getElementById("quickAssignModal").style.display = "flex";
    const btn = document.getElementById("qaBatchToggle");
    if (btn) btn.setAttribute("aria-pressed", "false");
    qaBatchMode = false; qaQueue = [];
    window.restartQuickAssignProcess();
};

window.resetQuickAssignUI = function() {
    qaCurrentStep = 1; qaIsProcessing = false;
    hideQuickQtyControls("qa"); setupQuickQtyHoldControls();
    setQuickScannerVisible("qa", true); setQuickBatchToggleVisible("qa", true);
    document.getElementById("qaTitle").textContent = "Quick Assign: Step 1";
    document.getElementById("qaInstruction").innerHTML = "Scan <b>Item</b> Barcode or Tap NFC";
    document.getElementById("qaMainContent").style.display = "block";
    document.getElementById("qaAssigneesList").style.display = "none";
    document.getElementById("qaSuccessContent").style.display = "none";
    document.getElementById("qaCancelContainer").style.display = "block";
    document.getElementById("qaSplashOverlay").classList.remove("active");
    const proceed = document.getElementById("qaProceedBatchBtn");
    if (proceed) proceed.style.display = "block";
    window.toggleQaBatchMode(qaBatchMode);
};

window.closeQuickAssignModal = function() {
    document.getElementById("quickAssignModal").style.display = "none";
    window.stopQuickAssignScanner(); window.stopQuickAssignNFC();
    qaIsProcessing = false;
};

window.toggleQaBatchMode = function(isChecked) {
    qaBatchMode = isChecked; updateQuickBatchButton("qa", isChecked);
    if (qaCurrentStep === 1) {
        document.getElementById("qaBatchQueueContainer").style.display = isChecked ? "block" : "none";
        window.renderQaQueueUI();
    }
};

window.clearQaQueue = function() { qaQueue = []; window.renderQaQueueUI(); };
window.renderQaQueueUI = function() {
    const count = document.getElementById("qaQueueCount");
    const list = document.getElementById("qaQueueList");
    if (count) count.textContent = qaQueue.length;
    if (!list) return;
    list.innerHTML = "";
    qaQueue.forEach((item, idx) => list.appendChild(renderQuickQueuePill("qa", item, idx, "background:#e0f2fe; color:#0369a1; border-color:#bae6fd;", i => { qaQueue.splice(i, 1); window.renderQaQueueUI(); })));
    const proceed = document.getElementById("qaProceedBatchBtn");
    if (proceed) proceed.disabled = qaQueue.length === 0;
};

window.proceedQaToStep2 = function() {
    if (qaQueue.length === 0) return;
    qaCurrentStep = 2;
    hideQuickQtyControls("qa"); setQuickScannerVisible("qa", true); setQuickBatchToggleVisible("qa", false);
    document.getElementById("qaTitle").textContent = "Quick Assign: Step 2";
    document.getElementById("qaInstruction").innerHTML = `Adjust quantities for <b style='color:#004a99;'>${qaQueue.length} item(s)</b>, then scan Assignee ID or select below`;
    document.getElementById("qaBatchQueueContainer").style.display = "block";
    document.getElementById("qaProceedBatchBtn").style.display = "none";
    document.getElementById("qaAssigneesList").style.display = "block";
    window.renderQaQueueUI(); window.renderQuickAssignees();
};

window.handleQuickAssignScan = async function(text) {
    if (qaIsProcessing || qaCurrentStep === 3 || !text) return;
    qaIsProcessing = true;
    const token = text.trim().toLowerCase();
    try {
        if (qaCurrentStep === 1) {
            const items = await localDB.items.toArray();
            const match = items.find(i => (i.barcode && i.barcode.trim().toLowerCase() === token) || (i.nfc_tag && i.nfc_tag.trim().toLowerCase() === token));
            if (!match) { await customAlert("No item found matching that code.", "Not Found"); qaIsProcessing = false; return; }
            if (qaBatchMode) { addQuickQueueItem("qa", match); window.renderQaQueueUI(); await window.triggerQaSplash(`${match.name} Added`); qaIsProcessing = false; }
            else { await window.triggerQaSplash("Item Captured!"); qaQueue = []; setQuickQtyControls("qa", match); qaIsProcessing = false; }
        } else if (qaCurrentStep === 2) {
            const assignees = await localDB.temp_locations.toArray();
            const match = assignees.find(a => (a.barcode && a.barcode.trim().toLowerCase() === token) || (a.nfc_tag && a.nfc_tag.trim().toLowerCase() === token));
            if (!match) { await customAlert("No assignee found matching that code.", "Not Found"); qaIsProcessing = false; return; }
            await window.triggerQaSplash("ID Verified!", 700);
            window.executeQuickAssignment(match.id, match.name);
        }
    } catch (e) { console.warn(e); qaIsProcessing = false; }
};

window.renderQuickAssignees = async function() {
    const grid = document.getElementById("qaAssigneesGrid");
    if (!grid) return;
    grid.innerHTML = "";
    (await localDB.temp_locations.toArray()).forEach(a => {
        const btn = document.createElement("button");
        btn.className = "qa-assignee-btn"; btn.textContent = a.name;
        btn.onclick = () => { if (qaCurrentStep === 2 && !qaIsProcessing) window.executeQuickAssignment(a.id, a.name); };
        grid.appendChild(btn);
    });
};

window.executeQuickAssignment = async function(assigneeId, assigneeName) {
    if (qaQueue.length === 0 || !assigneeId || qaCurrentStep === 3) return;
    qaIsProcessing = true; qaCurrentStep = 3;
    window.stopQuickAssignScanner(); window.stopQuickAssignNFC();
    let successCount = 0, unitCount = 0;
    for (let item of qaQueue) {
        const movedQty = await moveQuantityBetweenRows(item, getQuickQtyFromEntry(item), assigneeId, item.location_id);
        if (movedQty > 0) { successCount++; unitCount += movedQty; if (typeof logAction === "function") logAction("CHECKOUT", "Item", item.name, `Quick-Assigned ${isEquipmentAsset(item) ? "Equipment" : movedQty + " unit(s)"} to ${assigneeName}`); }
    }
    if (successCount > 0) {
        document.getElementById("qaMainContent").style.display = "none";
        document.getElementById("qaCancelContainer").style.display = "none";
        document.getElementById("qaSuccessContent").style.display = "block";
        document.getElementById("qaSuccessMessage").innerHTML = `Successfully checked out <b>${unitCount} unit(s)</b> across <b>${successCount} item line(s)</b> to <b>${assigneeName}</b>:<br><div style='margin-top:8px; line-height:1.4;'>${qaQueue.map(i => `&bull; <b>${i.name}</b> x${getQuickQtyFromEntry(i)}`).join("<br>")}</div>`;
        if (typeof refreshAllDataFromLocal === "function") await refreshAllDataFromLocal();
        if (window.processSyncQueue) window.processSyncQueue();
    } else { await customAlert("Failed to complete assignment records.", "Error"); qaCurrentStep = 2; }
    qaIsProcessing = false;
};

async function startQuickScanner(prefix, containerId, callback) {
    const map = { qa: "qaScannerInstance", qm: "qmScannerInstance", qr: "qrScannerInstance" };
    if (prefix === "qa" && qaScannerInstance) return;
    if (prefix === "qm" && qmScannerInstance) return;
    if (prefix === "qr" && qrScannerInstance) return;
    const scanner = new Html5Qrcode(containerId);
    if (prefix === "qa") qaScannerInstance = scanner;
    if (prefix === "qm") qmScannerInstance = scanner;
    if (prefix === "qr") qrScannerInstance = scanner;
    try {
        const targetLens = typeof determineActiveTargetLens === "function" ? await determineActiveTargetLens() : { facingMode: "environment" };
        await scanner.start(targetLens, { fps: 10, qrbox: { width: 250, height: 160 } }, txt => callback(txt), () => {});
        if (typeof applyHardwareZoomToContainer === "function") applyHardwareZoomToContainer(containerId);
    } catch (e) {
        console.warn(`${prefix} scanner start failed:`, e);
        if (prefix === "qa") qaScannerInstance = null;
        if (prefix === "qm") qmScannerInstance = null;
        if (prefix === "qr") qrScannerInstance = null;
    }
}

function stopScanner(instanceSetterPrefix) {
    const scanner = instanceSetterPrefix === "qa" ? qaScannerInstance : instanceSetterPrefix === "qm" ? qmScannerInstance : qrScannerInstance;
    if (!scanner) return;
    if (instanceSetterPrefix === "qa") qaScannerInstance = null;
    if (instanceSetterPrefix === "qm") qmScannerInstance = null;
    if (instanceSetterPrefix === "qr") qrScannerInstance = null;
    scanner.stop().then(() => scanner.clear()).catch(() => {});
}

window.startQuickAssignScanner = () => startQuickScanner("qa", "qaScannerReader", window.handleQuickAssignScan);
window.stopQuickAssignScanner = () => stopScanner("qa");
window.startQuickMoveScanner = () => startQuickScanner("qm", "qmScannerReader", window.handleQuickMoveScan);
window.stopQuickMoveScanner = () => stopScanner("qm");
window.startQuickReturnScanner = () => startQuickScanner("qr", "qrScannerReader", window.handleQuickReturnScan);
window.stopQuickReturnScanner = () => stopScanner("qr");

async function startQuickNFC(prefix, callback) {
    if (!("NDEFReader" in window)) return;
    try {
        const controller = new AbortController();
        if (prefix === "qa") qaNfcAbort = controller;
        if (prefix === "qm") qmNfcAbort = controller;
        if (prefix === "qr") qrNfcAbort = controller;
        const ndef = new NDEFReader();
        await ndef.scan({ signal: controller.signal });
        ndef.onreading = ev => {
            const token = getNfcTextFromEvent(ev);
            if (token) callback(token);
        };
    } catch (e) {}
}
function stopQuickNFC(prefix) {
    const controller = prefix === "qa" ? qaNfcAbort : prefix === "qm" ? qmNfcAbort : qrNfcAbort;
    if (controller) controller.abort();
    if (prefix === "qa") qaNfcAbort = null;
    if (prefix === "qm") qmNfcAbort = null;
    if (prefix === "qr") qrNfcAbort = null;
}
window.startQuickAssignNFC = () => startQuickNFC("qa", t => { if (qaCurrentStep !== 3 && !qaIsProcessing) window.handleQuickAssignScan(t); });
window.stopQuickAssignNFC = () => stopQuickNFC("qa");
window.startQuickMoveNFC = () => startQuickNFC("qm", t => { if (qmCurrentStep !== 3 && !qmIsProcessing) window.handleQuickMoveScan(t); });
window.stopQuickMoveNFC = () => stopQuickNFC("qm");
window.startQuickReturnNFC = () => startQuickNFC("qr", t => { if (!qrIsProcessing) window.handleQuickReturnScan(t); });
window.stopQuickReturnNFC = () => stopQuickNFC("qr");

function triggerQuickSplash(prefix, msg, dur = 900) {
    return new Promise(resolve => {
        const text = document.getElementById(`${prefix}SplashText`);
        const overlay = document.getElementById(`${prefix}SplashOverlay`);
        if (text) text.textContent = msg;
        if (overlay) overlay.classList.add("active");
        setTimeout(() => { if (overlay) overlay.classList.remove("active"); resolve(); }, dur);
    });
}
window.triggerQaSplash = (msg, dur) => triggerQuickSplash("qa", msg, dur);
window.triggerQmSplash = (msg, dur) => triggerQuickSplash("qm", msg, dur);
window.triggerQrSplash = (msg, dur) => triggerQuickSplash("qr", msg, dur);
window.restartQuickAssignProcess = function() { window.resetQuickAssignUI(); window.stopQuickAssignScanner(); window.stopQuickAssignNFC(); window.startQuickAssignScanner(); window.startQuickAssignNFC(); };

window.openQuickMoveModal = async function() {
    window.closeFab?.(); document.getElementById("quickMoveModal").style.display = "flex";
    const btn = document.getElementById("qmBatchToggle"); if (btn) btn.setAttribute("aria-pressed", "false");
    qmBatchMode = false; qmQueue = []; window.restartQuickMoveProcess();
};
window.resetQuickMoveUI = function() {
    qmCurrentStep = 1; qmIsProcessing = false; hideQuickQtyControls("qm"); setupQuickQtyHoldControls();
    setQuickScannerVisible("qm", true); setQuickBatchToggleVisible("qm", true);
    document.getElementById("qmTitle").textContent = "Quick Move: Step 1";
    document.getElementById("qmInstruction").innerHTML = "Scan <b>Item</b> Barcode or Tap NFC";
    document.getElementById("qmMainContent").style.display = "block"; document.getElementById("qmSuccessContent").style.display = "none";
    document.getElementById("qmCancelContainer").style.display = "block"; document.getElementById("qmSplashOverlay").classList.remove("active");
    const proceed = document.getElementById("qmProceedBatchBtn"); if (proceed) proceed.style.display = "block";
    window.toggleQmBatchMode(qmBatchMode);
};
window.closeQuickMoveModal = function() { document.getElementById("quickMoveModal").style.display = "none"; window.stopQuickMoveScanner(); window.stopQuickMoveNFC(); qmIsProcessing = false; };
window.toggleQmBatchMode = function(isChecked) {
    qmBatchMode = isChecked; updateQuickBatchButton("qm", isChecked);
    if (qmCurrentStep === 1) { document.getElementById("qmBatchQueueContainer").style.display = isChecked ? "block" : "none"; window.renderQmQueueUI(); }
};
window.clearQmQueue = function() { qmQueue = []; window.renderQmQueueUI(); };
window.renderQmQueueUI = function() {
    const count = document.getElementById("qmQueueCount"); const list = document.getElementById("qmQueueList");
    if (count) count.textContent = qmQueue.length; if (!list) return; list.innerHTML = "";
    qmQueue.forEach((item, idx) => list.appendChild(renderQuickQueuePill("qm", item, idx, "background:#e0f2fe; color:#0369a1; border-color:#bae6fd;", i => { qmQueue.splice(i, 1); window.renderQmQueueUI(); })));
    const proceed = document.getElementById("qmProceedBatchBtn"); if (proceed) proceed.disabled = qmQueue.length === 0;
};
window.proceedQmToStep2 = function() {
    if (qmQueue.length === 0) return; qmCurrentStep = 2; hideQuickQtyControls("qm"); setQuickScannerVisible("qm", true); setQuickBatchToggleVisible("qm", false);
    document.getElementById("qmTitle").textContent = "Quick Move: Step 2";
    document.getElementById("qmInstruction").innerHTML = `Adjust quantities for <b style='color:#004a99;'>${qmQueue.length} item(s)</b>, then scan Destination Bin/Shelf Code`;
    document.getElementById("qmBatchQueueContainer").style.display = "block"; document.getElementById("qmProceedBatchBtn").style.display = "none"; window.renderQmQueueUI();
};
window.handleQuickMoveScan = async function(text) {
    if (qmIsProcessing || qmCurrentStep === 3 || !text) return; qmIsProcessing = true;
    const token = text.trim().toLowerCase();
    try {
        if (qmCurrentStep === 1) {
            const items = await localDB.items.toArray();
            const match = items.find(i => (i.barcode && i.barcode.trim().toLowerCase() === token) || (i.nfc_tag && i.nfc_tag.trim().toLowerCase() === token));
            if (!match) { await customAlert("No item found matching that code.", "Not Found"); qmIsProcessing = false; return; }
            if (qmBatchMode) { addQuickQueueItem("qm", match); window.renderQmQueueUI(); await window.triggerQmSplash(`${match.name} Added`); qmIsProcessing = false; }
            else { await window.triggerQmSplash("Item Captured!"); qmQueue = []; setQuickQtyControls("qm", match); qmIsProcessing = false; }
        } else if (qmCurrentStep === 2) {
            const locations = await localDB.locations.toArray();
            const match = locations.find(l => locationMatchesToken(l, token));
            if (!match) { await customAlert("No destination location folder found matching that code.", "Not Found"); qmIsProcessing = false; return; }
            await window.triggerQmSplash("Location Verified!", 700); window.executeQuickMoveAssignment(match.id, match.name);
        }
    } catch (e) { console.warn(e); qmIsProcessing = false; }
};
window.executeQuickMoveAssignment = async function(destId, destName) {
    if (qmQueue.length === 0 || !destId || qmCurrentStep === 3) return; qmIsProcessing = true; qmCurrentStep = 3;
    window.stopQuickMoveScanner(); window.stopQuickMoveNFC();
    let successCount = 0, unitCount = 0;
    for (let item of qmQueue) { const movedQty = await moveQuantityBetweenRows(item, getQuickQtyFromEntry(item), item.assigned_to || null, destId); if (movedQty > 0) { successCount++; unitCount += movedQty; if (typeof logAction === "function") logAction("MOVE", "Item", item.name, `Relocated ${isEquipmentAsset(item) ? "Equipment" : movedQty + " unit(s)"} via Quick Move to ${destName}`); } }
    if (successCount > 0) {
        document.getElementById("qmMainContent").style.display = "none"; document.getElementById("qmCancelContainer").style.display = "none"; document.getElementById("qmSuccessContent").style.display = "block";
        const path = typeof buildLocationPath === "function" ? buildLocationPath(destId) : destName;
        document.getElementById("qmSuccessMessage").innerHTML = `Successfully relocated <b>${unitCount} unit(s)</b> across <b>${successCount} item line(s)</b> to:<br><span style="color:#004a99; font-weight:bold; font-size:14px; display:block; margin:6px 0;">${path}</span><div style='font-size:13px; color:#475569; max-height:80px; overflow-y:auto;'>${qmQueue.map(i => `&bull; ${i.name} x${getQuickQtyFromEntry(i)}`).join("<br>")}</div>`;
        if (typeof refreshAllDataFromLocal === "function") await refreshAllDataFromLocal(); if (window.processSyncQueue) window.processSyncQueue();
    } else { await customAlert("Failed to complete system relocation records.", "Error"); qmCurrentStep = 2; }
    qmIsProcessing = false;
};
window.restartQuickMoveProcess = function() { window.resetQuickMoveUI(); window.stopQuickMoveScanner(); window.stopQuickMoveNFC(); window.startQuickMoveScanner(); window.startQuickMoveNFC(); };

function tokenMatchesItem(item, token) { return (item.barcode && item.barcode.trim().toLowerCase() === token) || (item.nfc_tag && item.nfc_tag.trim().toLowerCase() === token); }
function getAssigneeName(assigneeId) { const a = tempLocationsAdmin.find(t => String(t.id) === String(assigneeId)); return a ? a.name : "Unknown assignee"; }
function handleQuickReturnLoanSelection(item) {
    document.getElementById("qrAssigneeSelectSection").style.display = "none";
    if (qrBatchMode) { addQuickQueueItem("qr", item); window.renderQrQueueUI(); window.triggerQrSplash(`${item.name} Added`); qrIsProcessing = false; }
    else { qrQueue = []; setQuickQtyControls("qr", item); qrIsProcessing = false; }
}
function showQuickReturnAssigneeChoices(matches) {
    const section = document.getElementById("qrAssigneeSelectSection"); const grid = document.getElementById("qrAssigneeListGrid");
    setQuickScannerVisible("qr", false); setQuickBatchToggleVisible("qr", false);
    section.querySelector("h4").textContent = matches.length > 1 ? "Multiple Active Loans Detected" : "Active Loan Detected";
    section.querySelector("p").textContent = "Select the assignee returning this item, then choose the quantity to check back in.";
    grid.innerHTML = "";
    matches.forEach(item => { const btn = document.createElement("button"); btn.type = "button"; btn.className = "qa-assignee-btn"; btn.innerHTML = `<b>${getAssigneeName(item.assigned_to)}</b><br><span style="font-size:12px; color:#64748b;">${item.name} x${getQuickMaxQty(item)}</span>`; btn.onclick = () => handleQuickReturnLoanSelection(item); grid.appendChild(btn); });
    section.style.display = "block";
}
window.openQuickReturnModal = async function() {
    window.closeFab?.(); document.getElementById("quickReturnModal").style.display = "flex";
    const btn = document.getElementById("qrBatchToggle"); if (btn) btn.setAttribute("aria-pressed", "false");
    qrBatchMode = false; qrQueue = []; qrIsProcessing = false; hideQuickQtyControls("qr"); setupQuickQtyHoldControls(); setQuickScannerVisible("qr", true); setQuickBatchToggleVisible("qr", true);
    document.getElementById("qrMainContent").style.display = "block"; document.getElementById("qrCancelContainer").style.display = "block"; document.getElementById("qrSplashOverlay").classList.remove("active"); document.getElementById("qrAssigneeSelectSection").style.display = "none";
    window.toggleQrBatchMode(false); window.startQuickReturnScanner(); window.startQuickReturnNFC();
};
window.closeQuickReturnModal = function() { document.getElementById("quickReturnModal").style.display = "none"; window.stopQuickReturnScanner(); window.stopQuickReturnNFC(); qrIsProcessing = false; };
window.toggleQrBatchMode = function(isChecked) { qrBatchMode = isChecked; updateQuickBatchButton("qr", isChecked); document.getElementById("qrBatchQueueContainer").style.display = isChecked ? "block" : "none"; window.renderQrQueueUI(); };
window.clearQrQueue = function() { qrQueue = []; window.renderQrQueueUI(); };
window.renderQrQueueUI = function() { const count = document.getElementById("qrQueueCount"); const list = document.getElementById("qrQueueList"); if (count) count.textContent = qrQueue.length; if (!list) return; list.innerHTML = ""; qrQueue.forEach((item, idx) => list.appendChild(renderQuickQueuePill("qr", item, idx, "background:#fee2e2; color:#991b1b; border-color:#fecaca;", i => { qrQueue.splice(i, 1); window.renderQrQueueUI(); }))); const proceed = document.getElementById("qrProceedBatchBtn"); if (proceed) proceed.disabled = qrQueue.length === 0; };
window.handleQuickReturnScan = async function(text) {
    if (qrIsProcessing || !text) return; qrIsProcessing = true;
    const token = text.trim().toLowerCase();
    try {
        const items = await localDB.items.toArray(); const matches = items.filter(i => tokenMatchesItem(i, token)); const loanMatches = matches.filter(i => i.assigned_to); const warehouseMatches = matches.filter(i => !i.assigned_to);
        if (loanMatches.length === 0 && warehouseMatches.length === 0) { await customAlert("No item found matching that asset token.", "Scan Failed"); qrIsProcessing = false; return; }
        if (loanMatches.length === 0) { await customAlert(`Item <b>[${warehouseMatches[0].name}]</b> is already in the warehouse (Not checked out).`, "Already In Stock"); qrIsProcessing = false; return; }
        showQuickReturnAssigneeChoices(loanMatches);
    } catch (e) { console.warn(e); qrIsProcessing = false; }
};
window.executeBatchReturn = async function() {
    if (qrQueue.length === 0) return; qrIsProcessing = true; window.stopQuickReturnScanner(); window.stopQuickReturnNFC();
    let textBreakdown = "", processedCount = 0, unitCount = 0;
    for (let item of qrQueue) { const returnedQty = await moveQuantityBetweenRows(item, getQuickQtyFromEntry(item), null, item.location_id); if (returnedQty > 0) { processedCount++; unitCount += returnedQty; if (typeof logAction === "function") logAction("RETURN", "Item", item.name, `Fast-Return ${isEquipmentAsset(item) ? "Equipment" : returnedQty + " unit(s)"} via Batch Smart Scanner`); const locPath = item.location_id && typeof buildLocationPath === "function" ? buildLocationPath(item.location_id) : "Unallocated Items"; textBreakdown += `&bull; <b>${item.name}</b> x${returnedQty} &rarr; Go to: <span style='color:#ff8c00; font-weight:600;'>${locPath}</span><br>`; } }
    if (processedCount > 0) { window.closeQuickReturnModal(); await customAlert(`Success! Checked in <b>${unitCount} unit(s)</b> across <b>${processedCount} item line(s)</b> back into stock.<br><br><b>Storage destinations breakdown:</b><br><div style='text-align:left; font-size:13px; margin-top:8px; line-height:1.5; background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0; max-height:150px; overflow-y:auto;'>${textBreakdown}</div>`, "Batch Processing Complete"); if (typeof refreshAllDataFromLocal === "function") await refreshAllDataFromLocal(); if (window.processSyncQueue) window.processSyncQueue(); }
    else await customAlert("Transaction could not clear database parameters.", "Write Error");
    qrIsProcessing = false;
};
window.restartQuickReturnProcess = function() { window.closeQuickReturnModal(); window.openQuickReturnModal(); };

function toggleStockUsageMode() {
    isStockUsageModeActive = !isStockUsageModeActive;
    stockUsageDraft.clear();

    const toggleBtn = document.getElementById("btnToggleStockUsageMode");
    const confirmBtn = document.getElementById("btnConfirmStockUsage");
    const cancelBtn = document.getElementById("btnCancelStockUsage");

    if (toggleBtn) {
        toggleBtn.textContent = isStockUsageModeActive ? "Stock Usage Active" : "Use Stock Mode";
        toggleBtn.style.background = isStockUsageModeActive ? "#fee2e2" : "";
    }
    if (confirmBtn) confirmBtn.style.display = isStockUsageModeActive ? "inline-flex" : "none";
    if (cancelBtn) cancelBtn.style.display = isStockUsageModeActive ? "inline-flex" : "none";

    if (currentTempLocationId) loadTempLocationDetails(currentTempLocationId);
}

function cancelStockUsageChanges() {
    if (isStockUsageModeActive) toggleStockUsageMode();
}

function setStockUsageQuantity(itemId, qty) {
    const inputQty = Math.max(0, parseInt(qty, 10) || 0);
    localDB.items.get(itemId).then(item => {
        if (!item) return;
        const maxQty = String(item.quantity).trim() === "-" ? 1 : Math.max(1, parseInt(item.quantity, 10) || 1);
        const finalQty = Math.min(inputQty, maxQty);
        if (finalQty <= 0) stockUsageDraft.delete(itemId);
        else stockUsageDraft.set(itemId, finalQty);
        if (currentTempLocationId) loadTempLocationDetails(currentTempLocationId);
    });
}

function adjustStockUsageQuantity(itemId, amount) {
    const currentQty = stockUsageDraft.get(itemId) || 0;
    setStockUsageQuantity(itemId, currentQty + amount);
}

async function confirmStockUsageChanges() {
    if (stockUsageDraft.size === 0) {
        await customAlert("No stock usage changes have been selected yet.", "Use Stock Mode");
        return;
    }

    if (window.isProcessingTransaction) return;
    window.isProcessingTransaction = true;

    try {
        const assignee = tempLocationsAdmin.find(t => t.id === currentTempLocationId);
        const assigneeName = assignee ? assignee.name : "Assignee";
        let usedLineCount = 0;
        let usedUnitCount = 0;

        for (const [itemId, requestedQty] of stockUsageDraft.entries()) {
            const item = await localDB.items.get(itemId);
            if (!item || String(item.assigned_to) !== String(currentTempLocationId)) continue;

            const isEquipment = String(item.quantity).trim() === "-";
            const currentQty = isEquipment ? 1 : Math.max(1, parseInt(item.quantity, 10) || 1);
            const qtyToUse = isEquipment ? 1 : Math.min(currentQty, Math.max(1, parseInt(requestedQty, 10) || 1));
            const remainingQty = currentQty - qtyToUse;

            if (isEquipment || remainingQty <= 0) {
                await window.offlineSafeWrite("DELETE", "items", null, item.id);
            } else {
                await window.offlineSafeWrite("UPDATE", "items", { quantity: remainingQty }, item.id);
            }

            usedLineCount++;
            usedUnitCount += qtyToUse;
            logAction("USE", "Item", item.name, `Used ${isEquipment ? "tool" : qtyToUse + " unit(s)"} from ${assigneeName}`);
        }

        stockUsageDraft.clear();
        isStockUsageModeActive = false;

        const toggleBtn = document.getElementById("btnToggleStockUsageMode");
        const confirmBtn = document.getElementById("btnConfirmStockUsage");
        const cancelBtn = document.getElementById("btnCancelStockUsage");
        if (toggleBtn) {
            toggleBtn.textContent = "Use Stock Mode";
            toggleBtn.style.background = "";
        }
        if (confirmBtn) confirmBtn.style.display = "none";
        if (cancelBtn) cancelBtn.style.display = "none";

        await refreshAllDataFromLocal();
        if (currentTempLocationId) await loadTempLocationDetails(currentTempLocationId);
        if (window.processSyncQueue) window.processSyncQueue();

        await customAlert(`Recorded <b>${usedUnitCount}</b> used unit(s) across <b>${usedLineCount}</b> item line(s). Any remaining quantity is still assigned to ${assigneeName}.`, "Stock Usage Recorded");
    } finally {
        window.isProcessingTransaction = false;
    }
}

/* =========================================================
   RICH ITEM MODALS: VIEWER & ASSIGNMENT LOGIC
========================================================= */
function ensureItemDetailsLayout() {
    const body = document.querySelector("#itemDetailsModal .item-detail-body");
    if (!body || body.dataset.layoutReady === "true") return;

    const main = body.querySelector(".item-detail-main");
    const actions = body.querySelector(".item-detail-actions");
    const name = document.getElementById("detailItemName");
    const location = document.getElementById("detailItemLocation");
    const category = document.getElementById("detailItemCategory");
    const description = document.getElementById("detailItemDescription");
    const tags = document.getElementById("detailItemTagsContainer");
    const barcode = document.getElementById("detailItemBarcode");

    if (!main || !actions || !name || !location || !category || !description || !tags || !barcode) return;

    const descriptionLabel = description.previousElementSibling;
    const tagsLabel = tags.previousElementSibling;
    const identityBlock = barcode.closest("div[style*='flex-direction: column']") || barcode.parentElement?.parentElement;

    const heading = document.createElement("div");
    heading.className = "item-detail-heading";
    heading.append(name, location, category);

    const info = document.createElement("div");
    info.className = "item-detail-info";
    if (descriptionLabel) info.append(descriptionLabel);
    info.append(description);
    if (identityBlock) info.append(identityBlock);

    const lower = document.createElement("div");
    lower.className = "item-detail-lower";
    lower.append(info, actions);

    const tagsBlock = document.createElement("div");
    tagsBlock.className = "item-detail-tags-block";
    if (tagsLabel) tagsBlock.append(tagsLabel);
    tagsBlock.append(tags);

    main.remove();
    body.append(heading, lower, tagsBlock);
    body.dataset.layoutReady = "true";
}

function openItemDetails(item) {
    ensureItemDetailsLayout();
    currentItemForActions = item;
    document.getElementById("detailItemName").textContent = item.name;
    
    // Evaluate if this is an Equipment Asset and color the badge dynamically
    const isEquipment = (String(item.quantity).trim() === "-");
    const qtyBadge = document.getElementById("detailItemQtyBadge");
    if (isEquipment) {
        qtyBadge.textContent = "Equipment Asset";
        qtyBadge.style.background = "#8b5cf6";
    } else {
        qtyBadge.textContent = "Qty: " + item.quantity;
        qtyBadge.style.background = "rgba(0,0,0,0.7)";
    }

    document.getElementById("detailItemDescription").textContent = item.description || "No description provided.";
    document.getElementById("detailItemBarcode").textContent = item.barcode || "—";
    document.getElementById("detailItemNFC").textContent = item.nfc_tag || "—";
    document.getElementById("detailItemLocation").textContent = item.location_id ? "📍 " + buildLocationPath(item.location_id) : "📍 Unallocated Items";
    const categoryEl = document.getElementById("detailItemCategory");
    if (categoryEl) categoryEl.textContent = item.category || "Uncategorised";

    const imgEl = document.getElementById("detailItemImage"); 
    const thumbsContainer = document.getElementById("detailItemThumbsRow"); 
    const expandBtn = document.getElementById("lightboxLauncherBtn");
    thumbsContainer.innerHTML = ""; lightboxImages = []; lightboxIndex = 0;

    if (item.photos && item.photos.length > 0) {
        expandBtn.style.display = "block";
        const sortedPhotos = [...item.photos].sort((a,b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));
        imgEl.src = window.db.storage.from("item-photos").getPublicUrl(sortedPhotos[0].file_path).data.publicUrl;
        
        sortedPhotos.forEach((photo, idx) => {
            const publicUrl = window.db.storage.from("item-photos").getPublicUrl(photo.file_path).data.publicUrl;
            lightboxImages.push(publicUrl);
            const thumbImg = document.createElement("img"); 
            thumbImg.className = `view-thumb-item ${idx === 0 ? 'active' : ''}`; 
            thumbImg.src = publicUrl;
            thumbImg.onclick = () => { 
                document.querySelectorAll(".view-thumb-item").forEach(t => t.classList.remove("active")); 
                thumbImg.classList.add("active"); 
                imgEl.src = publicUrl; 
                lightboxIndex = idx; 
            };
            thumbsContainer.appendChild(thumbImg);
        });
    } else { 
        imgEl.src = "../assets/images/no-image.jpg"; 
        expandBtn.style.display = "none"; 
    }

    const tagsContainer = document.getElementById("detailItemTagsContainer"); tagsContainer.innerHTML = "";
    let tagArray = Array.isArray(item.tags) ? item.tags : (typeof item.tags === 'string' && item.tags.trim() ? item.tags.split(',').map(t => t.trim()) : []);
    
    if (tagArray.length > 0) {
        tagArray.forEach(tag => {
            const span = document.createElement("span"); span.className = "tag-pill"; span.textContent = tag; 
            span.style.cursor = "pointer"; span.style.transition = "background 0.15s"; span.title = `Click to search for all items tagged with "${tag}"`;
            span.onmouseover = () => { span.style.background = "#bae6fd"; span.style.color = "#0369a1"; }; 
            span.onmouseout = () => { span.style.background = "#f1f5f9"; span.style.color = "#475569"; };
            span.onclick = () => clickSearchTag(tag); 
            tagsContainer.appendChild(span);
        });
    } else {
        tagsContainer.innerHTML = `<span style="color:#999; font-style:italic; font-size:13px;">No tags assigned</span>`;
    }

    const assignBtn = document.getElementById("btnAssignReturnToggle"); 
    const banner = document.getElementById("detailAssignedBanner"); 
    const nameLabel = document.getElementById("detailAssignedTargetName");
    
    if (item.assigned_to) {
        const tempLoc = tempLocationsAdmin.find(t => t.id === item.assigned_to);
        banner.style.display = "flex"; 
        nameLabel.textContent = tempLoc ? tempLoc.name : "Unknown User";
        assignBtn.textContent = "📥 Return Item"; 
        assignBtn.style.background = "#ef4444"; 
        assignBtn.style.borderColor = "#ef4444";
    } else {
        banner.style.display = "none"; 
        assignBtn.textContent = "👤 Assign"; 
        assignBtn.style.background = "#10b981"; 
        assignBtn.style.borderColor = "#10b981";
    }
    
    document.getElementById("itemDetailsModal").style.display = "flex";
    resetModalScroll("itemDetailsModal");
}

async function closeItemDetailsModal() {
    const item = currentItemForActions;
    closeModal("itemDetailsModal");
    if (!item) return;
    lastMovedItemId = item.id;
    if (item.location_id) {
        currentLocationId = item.location_id;
        await loadLocation(item.location_id);
    } else {
        currentLocationId = "unallocated";
        await loadUnallocatedItems();
    }
    setTimeout(() => { lastMovedItemId = null; }, 6000);
}

function openLightbox() { if (!lightboxImages || lightboxImages.length === 0) return; document.getElementById("review-lightbox").style.display = "flex"; updateLightboxUI(); }
function closeLightbox() { document.getElementById("review-lightbox").style.display = "none"; }
function changeLightboxImage(direction) { lightboxIndex += direction; if (lightboxIndex < 0) lightboxIndex = lightboxImages.length - 1; if (lightboxIndex >= lightboxImages.length) lightboxIndex = 0; updateLightboxUI(); }
function updateLightboxUI() { const imgEl = document.getElementById("lightbox-img"); const counterEl = document.getElementById("lightbox-counter"); if (imgEl && lightboxImages[lightboxIndex]) imgEl.src = lightboxImages[lightboxIndex]; if (counterEl) counterEl.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`; }
// Local strings to store assets during layout transitions inside the edit panel view context
let editModalActiveBarcodeString = "";
let editModalActiveNfcTagString = "";

// --- INTELLIGENT HARDWARE LENS INITIALIZATION & SELECTION REGISTRY ---
async function getOrFetchCameras() {
    try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
            globalCamerasList = [...devices].sort((a, b) => {
                const labelA = a.label.toLowerCase();
                const labelB = b.label.toLowerCase();
                
                const isBackA = labelA.includes('back') || labelA.includes('rear') || labelA.includes('environment');
                const isBackB = labelB.includes('back') || labelB.includes('rear') || labelB.includes('environment');
                
                if (isBackA && !isBackB) return -1;
                if (!isBackA && isBackB) return 1;
                
                if (labelA.includes('wide') && !labelA.includes('ultra') && !labelB.includes('wide')) return -1;
                if (labelB.includes('wide') && !labelB.includes('ultra') && !labelA.includes('wide')) return 1;
                
                return 0;
            });
        }
    } catch (e) { console.log("Camera list compilation fault:", e); }
    return globalCamerasList;
}

// Global Hardware Preferences Save Routine
window.saveHardwarePreferences = async function() {
    const camId = document.getElementById("settingsDefaultCamera").value;
    const zoomVal = parseFloat(document.getElementById("settingsDefaultZoom").value) || 1.5;
    
    userSettings.defaultCameraId = camId;
    userSettings.defaultZoom = zoomVal;
    
    if (typeof saveInventorySettings === "function") {
        await saveInventorySettings();
    } else if (typeof localDB !== "undefined" && localDB.settings) {
        await localDB.settings.put({ id: "user_preferences", value: userSettings });
    }
};

// Populate selection choices within Settings Panel UI layout grids
window.populateHardwareSettingsDropdowns = async function() {
    const dropdown = document.getElementById("settingsDefaultCamera");
    const slider = document.getElementById("settingsDefaultZoom");
    const display = document.getElementById("settingsZoomValDisplay");
    if (!dropdown) return;
    
    slider.value = userSettings.defaultZoom || 1.5;
    display.textContent = (userSettings.defaultZoom || 1.5) + "x";
    
    const cameras = await getOrFetchCameras();
    dropdown.innerHTML = `<option value="AUTO_REAR" ${userSettings.defaultCameraId === 'AUTO_REAR' ? 'selected' : ''}>🎯 Auto-Select Main Rear Lens</option>`;
    
    cameras.forEach(cam => {
        const option = document.createElement("option");
        option.value = cam.id;
        option.textContent = cam.label || `Camera Node Map [${cam.id.substring(0, 6)}]`;
        if (String(userSettings.defaultCameraId) === String(cam.id)) {
            option.selected = true;
        }
        dropdown.appendChild(option);
    });
};

// Hardware constraints optical macro zoom modifier injector engine
function applyHardwareZoomToContainer(containerId) {
    setTimeout(() => {
        const container = document.getElementById(containerId);
        if (!container) return;
        const videoEl = container.querySelector("video");
        if (videoEl && videoEl.srcObject) {
            const track = videoEl.srcObject.getVideoTracks()[0];
            if (track && typeof track.getCapabilities === "function") {
                const capabilities = track.getCapabilities();
                if ("zoom" in capabilities) {
                    let targetZoomMultiplier = parseFloat(userSettings.defaultZoom) || 1.5;
                    if (targetZoomMultiplier < capabilities.zoom.min) targetZoomMultiplier = capabilities.zoom.min;
                    if (targetZoomMultiplier > capabilities.zoom.max) targetZoomMultiplier = capabilities.zoom.max;
                    
                    track.applyConstraints({
                        advanced: [{ zoom: targetZoomMultiplier }]
                    }).catch(e => console.log("Optical Zoom hardware constraint fault:", e));
                }
            }
        }
    }, 450); 
}

// Core Runtime Context Camera Switch Logic
window.switchScannerCamera = async function(modalPrefix) {
    try {
        const devices = await getOrFetchCameras();
        if (!devices || devices.length <= 1) {
            alert("⚠️ Only one rear hardware lens element detected on this platform."); return;
        }
        currentCameraIndex = (currentCameraIndex + 1) % devices.length;
        userSettings.defaultCameraId = devices[currentCameraIndex].id;
        
        if (modalPrefix === 'qa') { stopQuickAssignScanner(); startQuickAssignScanner(); }
        else if (modalPrefix === 'qm') { stopQuickMoveScanner(); startQuickMoveScanner(); }
        else if (modalPrefix === 'qr') { stopQuickReturnScanner(); startQuickReturnScanner(); }
        else if (modalPrefix === 'main') {
            if (typeof closeBarcodeScannerModal === 'function' && typeof openBarcodeScannerModal === 'function') {
                const targetField = window.currentBarcodeTargetField || null;
                closeBarcodeScannerModal();
                setTimeout(() => { openBarcodeScannerModal(targetField); }, 250);
            }
        }
    } catch (err) { console.warn(err); }
};

// 1. FIXED LENS DETERMINER (More resilient)
async function determineActiveTargetLens() {
    try {
        const devices = await getOrFetchCameras();
        if (!devices || devices.length === 0) return { facingMode: "environment" };
        
        // If user has a preference, try to find it in the current device list
        if (userSettings.defaultCameraId && userSettings.defaultCameraId !== "AUTO_REAR") {
            const savedMatch = devices.find(d => String(d.id) === String(userSettings.defaultCameraId));
            if (savedMatch) return { deviceId: { exact: savedMatch.id } };
        }
        
        // Fallback to primary rear lens
        return { deviceId: { exact: devices[0].id } };
    } catch (e) {
        return { facingMode: "environment" };
    }
}

// --- 1. OVERRIDE SEARCH FOR INSTANT LOCATION NAVIGATION ---
if (typeof handleGlobalSearch === "function" && !window.searchInterceptApplied) {
    window.searchInterceptApplied = true;
    const originalGlobalSearch = handleGlobalSearch;
    window.handleGlobalSearch = async function(term) {
        // Typed search must stay as search. Barcode/NFC location navigation is handled
        // by routeGlobalHardwareScan so single letters like "B" do not hijack typing.
        return originalGlobalSearch(term);
    };
}

// --- 2. THE 3-BUTTON BARCODE ACTION MODAL ---
window.triggerEditModalBarcodeScan = async function() {
    if (editModalActiveBarcodeString.trim() !== "") {
        const action = await new Promise((resolve) => {
            document.getElementById("dialogTitle").textContent = "Manage Barcode";
            document.getElementById("dialogMessage").innerHTML = `An active barcode is already mapped to this item:<br><b style="color:#004a99; font-size:16px;">${editModalActiveBarcodeString}</b><br><br>What would you like to do?`;
            
            const btnContainer = document.getElementById("dialogButtons");
            btnContainer.innerHTML = `
                <button class="btn-danger" id="dialogDeleteBtn" style="min-width: 80px; padding:8px 10px; font-size:13px;">Delete</button>
                <button class="btn-primary" id="dialogRewriteBtn" style="min-width: 80px; padding:8px 10px; font-size:13px; background:#ff8c00; border-color:#ff8c00;">Rewrite</button>
                <button class="btn-outline" id="dialogCancelBtn" style="min-width: 80px; padding:8px 10px; font-size:13px;">Cancel</button>
            `;
            document.getElementById("customDialogModal").style.display = "flex";
            
            document.getElementById("dialogDeleteBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve('delete'); };
            document.getElementById("dialogRewriteBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve('rewrite'); };
            document.getElementById("dialogCancelBtn").onclick = () => { document.getElementById("customDialogModal").style.display = "none"; resolve('cancel'); };
        });

        if (action === 'delete') {
            editModalActiveBarcodeString = "";
            updateEditModalHardwareButtonsUI();
            return;
        } else if (action === 'cancel') {
            return;
        }
    }
    window.openBarcodeScannerModal('EDIT_MODAL_BARCODE_INTERNAL_TUNNEL');
};

// --- 3. NFC BACKGROUND LISTENER & DELETE PROMPT ---
window.triggerEditModalNfcClearanceRequest = async function() {
    if (editModalActiveNfcTagString.trim() !== "") {
        const confirmPurge = await customConfirm("An active NFC tag mapping exists on this item card. Do you want to detach and delete it?", "Remove NFC Identity Tag?");
        if (confirmPurge) {
            editModalActiveNfcTagString = "";
            updateEditModalHardwareButtonsUI();
        }
    } else {
        window.openNfcScannerModal('EDIT_MODAL_NFC_INTERNAL_TUNNEL');
    }
};

/* =========================================================
   DYNAMIC UNIFIED FILTER SURFACE MENU
========================================================= */
function toggleFilterToolbar() {
    const panel = document.getElementById("mobileFilterPanel");
    if (!panel) return;
    
    if (window.getComputedStyle(panel).display === "none" || !panel.classList.contains("visible")) {
        panel.style.display = "block";
        setTimeout(() => panel.classList.add("visible"), 20);
    } else {
        panel.classList.remove("visible");
        setTimeout(() => {
            if (!panel.classList.contains("visible")) panel.style.display = "none";
        }, 260); 
    }
}

document.addEventListener('click', function(event) {
    const panel = document.getElementById("mobileFilterPanel");
    if (!panel || !panel.classList.contains("visible")) return;
    
    const clickedInside = panel.contains(event.target);
    const clickedToggleBtn = event.target.closest('[onclick*="toggleFilterToolbar"]') || event.target.textContent.includes('👁️');
    
    if (!clickedInside && !clickedToggleBtn) toggleFilterToolbar();
});

/* =========================================================
   CUSTOM ROUNDED DROPDOWN LOGIC
========================================================= */
function toggleCustomSelect(triggerElement) {
    document.querySelectorAll('.custom-select-options').forEach(ul => {
        if (ul !== triggerElement.nextElementSibling) ul.classList.remove('open');
    });
    triggerElement.nextElementSibling.classList.toggle('open');
}

function handleCustomSelect(liElement, functionName, value) {
    const trigger = liElement.parentElement.previousElementSibling;
    const textSpan = trigger.querySelector('.trigger-text');
    
    if (textSpan) textSpan.textContent = liElement.textContent;
    else trigger.innerHTML = `<span class="trigger-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${liElement.textContent}</span> <span class="caret" style="font-size:9px; color:#94a3b8; margin-left:2px;">▼</span>`;
    
    Array.from(liElement.parentElement.children).forEach(sibling => sibling.classList.remove('selected'));
    liElement.classList.add('selected');
    liElement.parentElement.classList.remove('open');

    if (functionName === 'changeItemsView') {
        changeItemsView(value);
        if(typeof changeLocationsView === 'function') changeLocationsView(value);
    } else if (functionName === 'changeItemsBrowserMode') {
        changeItemsBrowserMode(value);
        if(typeof changeAdminLocationView === 'function') changeAdminLocationView(value === 'flat' ? 'flat' : 'hierarchy');
    } else if (functionName === 'changeSortOrder') {
        changeSortOrder(value);
        if(typeof changeSortOrderLocations === 'function') changeSortOrderLocations(value);
    }
}

function updateCustomSelectUI(functionName, value) {
    const options = document.querySelectorAll(`li[onclick*="${functionName}"]`);
    options.forEach(li => {
        if (li.getAttribute('onclick').includes(`'${value}'`) || li.getAttribute('onclick').includes(`"${value}"`)) {
            const trigger = li.parentElement.previousElementSibling;
            if (trigger) {
                const textSpan = trigger.querySelector('.trigger-text');
                if (textSpan) textSpan.textContent = li.textContent;
            }
            Array.from(li.parentElement.children).forEach(sibling => sibling.classList.remove('selected'));
            li.classList.add('selected');
        }
    });
}
window.updateLocationDropdownUI = function(selectId, match) {
    // 1. Log to the console so we know the scanner actually found it
    console.log("✅ Scanner matched location:", match.name, "| ID:", match.id);
    
    const selectEl = document.getElementById(selectId);
    if (selectEl) {
        setLocationSelectValue(selectEl, match.id, true);
        return;
    }
    if (!selectEl) {
        console.error("❌ Could not find dropdown with ID:", selectId);
        return;
    }

    // 2. Determine the full path name to display (e.g., "Warehouse > Shelf A")
    const fullPathName = typeof buildLocationPath === 'function' ? buildLocationPath(match.id) : match.name;
    
    // 3. Set the standard background value
    selectEl.value = match.id;
    
    // 4. AGGRESSIVE OVERRIDE: If it's a standard <select>, force the <option> selection
    if (selectEl.tagName === 'SELECT') {
        for (let i = 0; i < selectEl.options.length; i++) {
            if (selectEl.options[i].value === match.id) {
                selectEl.selectedIndex = i; // Force the browser to show this specific item
                console.log("🎯 Successfully locked <select> to:", fullPathName);
                break;
            }
        }
    }

    // 5. AGGRESSIVE OVERRIDE: If you are using a custom text wrapper, force the text to change
    const customTrigger = selectEl.parentElement?.querySelector('.trigger-text') || selectEl.querySelector('.trigger-text');
    if (customTrigger) {
        customTrigger.textContent = fullPathName;
        console.log("🎯 Successfully updated custom <span class='trigger-text'> to:", fullPathName);
    }

    // 6. Fire the change event so the rest of the app knows it was modified
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));

    // 7. Visual Feedback (Flash Green)
    const targetVisual = customTrigger ? customTrigger.parentElement : selectEl;
    const originalBg = targetVisual.style.backgroundColor;
    const originalTransition = targetVisual.style.transition;
    
    targetVisual.style.transition = "background-color 0.4s ease";
    targetVisual.style.backgroundColor = "#dcfce7"; // Flash green
    
    setTimeout(() => {
        targetVisual.style.backgroundColor = originalBg;
        targetVisual.style.transition = originalTransition;
    }, 1000);
};

document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-select-wrapper')) {
        document.querySelectorAll('.custom-select-options').forEach(ul => ul.classList.remove('open'));
    }
});

/* =========================================================
   COLUMN PICKER TOGGLE ENGINE
========================================================= */
function toggleColumnMenu(event, menuId) {
    event.stopPropagation(); 
    const menu = document.getElementById(menuId);
    const btn = event.currentTarget;
    if (!menu) return;

    const rect = btn.getBoundingClientRect();
    if (window.getComputedStyle(menu).display === "none") {
        menu.style.display = "block"; 
        menu.style.position = "absolute";
        menu.style.top = (rect.bottom + window.scrollY + 5) + "px";
        menu.style.left = (rect.left + window.scrollX) + "px";
    } else {
        menu.style.display = "none";
    }
}

document.addEventListener('click', function(e) {
    document.querySelectorAll('.col-picker-menu').forEach(menu => {
        if (!menu.contains(e.target)) menu.style.display = 'none';
    });
});

function showSettingsTab(tabId, btn) {
    document.querySelectorAll('.settings-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.s-tab').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).style.display = 'block';
    btn.classList.add('active');
    if (tabId === 'settings-logs') loadAuditLogs();
}

/* =========================================================
   IMPORT ENGINE
========================================================= */
let pendingImportData = null;

function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            pendingImportData = JSON.parse(e.target.result);
            document.getElementById('importWarningModal').style.display = 'flex';
        } catch (err) { customAlert("Invalid JSON file provided.", "Import Error"); }
    };
    reader.readAsText(file);
    input.value = ""; 
}

async function executeImport() {
    const confirmText = document.getElementById('importConfirmText').value;
    if (confirmText !== "CONFIRMIMPORT") return await customAlert("You must type CONFIRMIMPORT exactly as shown.", "Access Denied");
    if (!pendingImportData || !pendingImportData.tables) return await customAlert("Invalid backup file.", "Error");

    isImportingSyncLock = true;
    window.setStatus("syncing", "Wiping and Importing...");

    try {
        const tables = [
            { db: 'items', json: 'items' }, { db: 'locations', json: 'locations' },
            { db: 'temp_locations', json: 'temp_locations' }, { db: 'tags', json: 'tags' },
            { db: 'item_categories', json: 'categories' }
        ];

        for (let t of tables.reverse()) await window.db.from(t.db).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        for (let t of tables) await localDB[t.db].clear();
        for (let t of tables) { if (pendingImportData.tables[t.json]?.length > 0) await window.db.from(t.db).insert(pendingImportData.tables[t.json]); }
        for (let t of tables) await localDB[t.db].bulkPut(pendingImportData.tables[t.json]);
        
        await localDB.sync_queue.clear();
        closeModal('importWarningModal');
        await customAlert("System Overwritten Successfully!", "Success");
        window.location.reload();
    } catch (e) {
        console.error("Critical Import Error:", e);
        await customAlert("Import Failed: " + e.message, "Critical Error");
    } finally {
        isImportingSyncLock = false;
        window.setStatus("connected", "Ready");
    }
}

function setImportMode(mode, element) {
    document.querySelector(`input[name="importMode"][value="${mode}"]`).checked = true;
    document.querySelectorAll('.radio-card').forEach(card => card.classList.remove('active'));
    element.classList.add('active');

    const appendCard = document.getElementById('card-append');
    const eraseCard = document.getElementById('card-erase');

    if (mode === 'append') {
        appendCard.querySelector('.card-label').textContent = 'SELECTED - MERGE';
        eraseCard.querySelector('.card-label').textContent = 'REPLACE';
    } else {
        appendCard.querySelector('.card-label').textContent = 'MERGE';
        eraseCard.querySelector('.card-label').textContent = 'SELECTED - REPLACE';
    }
}

