/* =========================================================
   WARM RIGHT LTD - UNIVERSAL OFFLINE ENGINE
   Powered by Dexie.js (IndexedDB)
========================================================= */

// 1. Initialize the Local Database
const localDB = new Dexie("WarmRightOfflineDB");

// Version 3: Added audit_logs for offline settings page
localDB.version(3).stores({
    items: 'id, name, location_id, assigned_to, category, barcode, nfc_tag', 
    locations: 'id, parent_id, barcode, nfc_tag',
    temp_locations: 'id, barcode, nfc_tag',
    tags: 'id, name',
    item_categories: 'id, name',
    jobs: 'id, status, engineer_id, scheduled_date',
    sync_queue: '++id, action, table, payload, created_at, status',
    sync_photos_queue: '++id, record_id, record_type, bucket, file_name, base64_data, is_primary, status',
    audit_logs: 'id, created_at, action_type'
});

// Version 4: Persistent local image cache for offline-first photos
localDB.version(4).stores({
    items: 'id, name, location_id, assigned_to, category, barcode, nfc_tag',
    locations: 'id, parent_id, barcode, nfc_tag',
    temp_locations: 'id, barcode, nfc_tag',
    tags: 'id, name',
    item_categories: 'id, name',
    jobs: 'id, status, engineer_id, scheduled_date',
    sync_queue: '++id, action, table, payload, created_at, status',
    sync_photos_queue: '++id, record_id, record_type, bucket, file_name, base64_data, is_primary, status',
    audit_logs: 'id, created_at, action_type',
    image_cache: 'key, bucket, file_name, updated_at'
});

// Global state tracker
window.isAppOnline = navigator.onLine;

// 2. Global Network Listeners
function initOfflineEngine() {
    console.log("🌐 Offline Engine Initialized. Local DB Ready.");
    
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(registration => {
                console.log('🛠️ ServiceWorker registration successful with scope: ', registration.scope);
                registration.update();
            }).catch(err => {
                console.log('⚠️ ServiceWorker registration failed: ', err);
            });
        });
    }

    // Create the status pill if it doesn't exist
    if (!document.querySelector('.status-indicator')) {
        const box = document.createElement("div");
        box.className = "status-indicator";
        document.body.appendChild(box);
    }

    // Set initial state
    updateNetworkUI(navigator.onLine);
    if (navigator.onLine) {
        setTimeout(() => window.processSyncQueue(), 500);
    }

    // Listen for connection drops
    window.addEventListener('offline', () => {
        window.isAppOnline = false;
        updateNetworkUI(false);
    });

    // Listen for connection returns
    window.addEventListener('online', () => {
        window.isAppOnline = true;
        updateNetworkUI(true);
        // Automatically push any queued tasks the moment internet returns!
        window.processSyncQueue(); 
    });
}

// 3. Status Pill Controller (Updated for HTML Icons)
function updateNetworkUI(isOnline) {
    const statusBox = document.querySelector('.status-indicator');
    if (!statusBox) return;

    if (isOnline) {
        statusBox.style.background = "#22c55e"; // Green
        statusBox.innerHTML = '<div class="icon icon-cloud-check-duotone"></div>';
    } else {
        statusBox.style.background = "#ef4444"; // Red
        statusBox.innerHTML = '<div class="icon icon-cloud-slash-duotone"></div>';
    }
}

// Global helper for system messages (Strict Offline-Enforcement with HTML Injection)
window.setStatus = function(mode, msg) {
    const statusBox = document.querySelector('.status-indicator');
    if (!statusBox) return;

    // Strict override: Never show green/connected if physically offline!
    if (!window.isAppOnline && mode === "connected") {
        mode = "error";
        msg = '<div class="icon icon-cloud-slash-duotone"></div>';
    }

    if (mode === "syncing") statusBox.style.background = "#ff8c00"; // Orange
    else if (mode === "error") statusBox.style.background = "#ef4444"; // Red
    else statusBox.style.background = "#22c55e"; // Green

    statusBox.innerHTML = msg;
}

function companyScopedSelect(table, columns = "*") {
    let query = window.db.from(table).select(columns);
    const companyId = typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null;
    if (!companyId) throw new Error(`Cannot sync ${table}: no companies_id resolved for the signed-in user.`);
    return query.eq("companies_id", companyId);
}

async function getCompanyScopedRemoteCount(table) {
    const companyId = typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null;
    if (!companyId) return { table, companyId: null, count: null, error: "No companies_id resolved" };
    const { count, error } = await window.db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("companies_id", companyId);
    return { table, companyId, count, error: error ? error.message || String(error) : null };
}

window.debugCompanySync = async function() {
    const tables = ["items", "locations", "temp_locations", "tags", "item_categories", "audit_logs"];
    const remote = [];
    for (const table of tables) remote.push(await getCompanyScopedRemoteCount(table));
    const local = {
        items: await localDB.items.count(),
        locations: await localDB.locations.count(),
        temp_locations: await localDB.temp_locations.count(),
        tags: await localDB.tags.count(),
        item_categories: await localDB.item_categories.count(),
        audit_logs: await localDB.audit_logs.count()
    };
    const state = typeof window.getCurrentCompanyDebugState === "function" ? window.getCurrentCompanyDebugState() : {};
    return { state, remote, local };
};

async function clearCompanyScopedLocalTables() {
    await Promise.all([
        localDB.items.clear(),
        localDB.locations.clear(),
        localDB.temp_locations.clear(),
        localDB.tags.clear(),
        localDB.item_categories.clear(),
        localDB.audit_logs.clear()
    ]);
}

// 5. Global Data Down-Sync (Downloads Supabase -> Saves to Dexie)
window.syncDatabaseToLocal = async function() {
    if (!window.isAppOnline) return; // Abort if offline

    window.setStatus("syncing", '<div class="icon icon-cloud-arrow-down-duotone"></div>');
    
    try {
        console.log("🔄 Starting Down-Sync...");

        const companyId = typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null;
        if (!companyId) {
            await clearCompanyScopedLocalTables();
            if (typeof refreshAllDataFromLocal === "function") await refreshAllDataFromLocal();
            throw new Error("No companies_id was resolved for this user. Local inventory cache cleared to prevent cross-company data leakage.");
        }

        // 1. Sync Items
        const { data: itemsData, error: itemsErr } = await companyScopedSelect('items', '*, photos(file_path, is_primary)');
        if (!itemsErr && itemsData) {
            await localDB.items.clear();
            await localDB.items.bulkPut(itemsData);
            console.log(`📥 Synced ${itemsData.length} Items`);
        } else { console.warn("⚠️ Items sync failed:", itemsErr); }

        // 2. Sync Locations
        const { data: locData, error: locErr } = await companyScopedSelect('locations');
        if (!locErr && locData) {
            await localDB.locations.clear();
            await localDB.locations.bulkPut(locData);
            console.log(`📥 Synced ${locData.length} Locations`);
        } else { console.warn("⚠️ Locations sync failed:", locErr); }

        // 3. Sync Assignees (Temp Locations)
        const { data: tempData, error: tempErr } = await companyScopedSelect('temp_locations');
        if (!tempErr && tempData) {
            await localDB.temp_locations.clear();
            await localDB.temp_locations.bulkPut(tempData);
            console.log(`📥 Synced ${tempData.length} Assignees`);
        } else { console.warn("⚠️ Assignees sync failed:", tempErr); }

        // 4. Sync Tags
        const { data: tagData, error: tagErr } = await companyScopedSelect('tags');
        if (!tagErr && tagData) {
            await localDB.tags.clear();
            await localDB.tags.bulkPut(tagData);
            console.log(`📥 Synced ${tagData.length} Tags`);
        } else { console.warn("⚠️ Tags sync failed:", tagErr); }

        // 5. Sync Categories
        const { data: catData, error: catErr } = await companyScopedSelect('item_categories');
        if (!catErr && catData) {
            await localDB.item_categories.clear();
            await localDB.item_categories.bulkPut(catData);
            console.log(`📥 Synced ${catData.length} Categories`);
        } else { console.warn("⚠️ Categories sync failed:", catErr); }

        // 6. Sync Audit Logs (Limit to 200 so we don't overload the phone)
        const { data: auditData, error: auditErr } = await companyScopedSelect('audit_logs').order('created_at', { ascending: false }).limit(500);
        if (!auditErr && auditData) {
            const visibleAuditData = typeof window.getFilteredAuditLogsForCurrentUser === "function"
                ? window.getFilteredAuditLogsForCurrentUser(auditData)
                : auditData;
            await localDB.audit_logs.clear();
            await localDB.audit_logs.bulkPut(visibleAuditData.slice(0, 200));
            console.log(`📥 Synced ${visibleAuditData.length} Audit Logs`);
        } else { console.warn("⚠️ Audit Logs sync failed:", auditErr); }

        console.log("✅ Offline Database fully synced with Supabase!");
        window.setStatus("connected", '<div class="icon icon-cloud-check-duotone"></div>');

        // Tell the UI to refresh its arrays now that we have fresh data
        if (typeof refreshAllDataFromLocal === "function") refreshAllDataFromLocal();

    } catch (err) {
        console.error("Down-sync failed critically:", err);
        window.setStatus("error", '<div class="icon icon-cloud-warning-duotone"></div>');
    }
};

// Auto-start the engine when the script loads
document.addEventListener('DOMContentLoaded', initOfflineEngine);

/* =========================================================
   MASTER OFFLINE WRITE & SYNC ENGINE
========================================================= */

function sanitizeSyncPayload(table, payload) {
    if (!payload || typeof payload !== "object") return payload;
    const clean = { ...payload };

    Object.keys(clean).forEach(key => {
        if (key.startsWith("_")) delete clean[key];
    });

    if (table === "items") {
        delete clean.photos;
    }

    return clean;
}

function addCompanyScopeToSyncPayload(table, payload) {
    const companyScopedTables = new Set(["items", "locations", "temp_locations", "tags", "item_categories", "audit_logs"]);
    if (!payload || typeof payload !== "object" || !companyScopedTables.has(table)) return payload;
    if (payload.companies_id) return payload;
    const companyId = typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null;
    if (!companyId) throw new Error(`Cannot write ${table}: no companies_id resolved for the signed-in user.`);
    return { ...payload, companies_id: companyId };
}

// 6. Universal Offline Writer (Upgraded with Client-Side UUIDs)
window.offlineSafeWrite = async function(action, table, payload, recordId = null) {
    try {
        let finalId = recordId;
        let localPayload = addCompanyScopeToSyncPayload(table, sanitizeSyncPayload(table, payload));
        
        // 1. Save to Local Dexie DB first (Optimistic UI)
        if (action === 'CREATE') {
            // Generate a real database UUID right here on the phone!
            finalId = crypto.randomUUID(); 
            localPayload = { ...localPayload, id: finalId }; // Inject it so Supabase accepts it later
            await localDB[table].put(localPayload);
        } else if (action === 'UPDATE') {
            await localDB[table].update(recordId, localPayload);
        } else if (action === 'DELETE') {
            await localDB[table].delete(recordId);
        }

        // 2. Add the action to the Sync Queue
        await localDB.sync_queue.add({ action, table, payload: localPayload, record_id: finalId, created_at: new Date().toISOString(), status: 'pending' });

        // 3. Trigger Sync
        window.processSyncQueue();
        
        // Return the finalId so we can attach offline photos to it!
        return { success: true, id: finalId }; 
    } catch (err) {
        console.error("Offline write failed:", err); return { error: err };
    }
};

// 7. The Queue Processor (Upgraded with Photo Sync & HTML Status Components)
window.processSyncQueue = async function() {
    if (!window.isAppOnline) {
        window.setStatus("error", '<div class="icon icon-floppy-disk-back-duotone"></div>');
        return;
    }

    try {
        // --- A. PROCESS NORMAL DATA ---
        const pendingTasks = await localDB.sync_queue.where('status').equals('pending').toArray();
        if (pendingTasks.length > 0) {
            window.setStatus("syncing", `<span style="margin-right: 5px; font-weight: bold;">${pendingTasks.length}</span><div class="icon icon-cloud-arrow-up-duotone"></div>`);
            for (const task of pendingTasks) {
                let error = null;
                const syncPayload = addCompanyScopeToSyncPayload(task.table, sanitizeSyncPayload(task.table, task.payload));

                if (task.action === 'CREATE') {
                    const { error: err } = await window.db.from(task.table).upsert([syncPayload]);
                    error = err;
                }
                else if (task.action === 'UPDATE') { const { error: err } = await window.db.from(task.table).update(syncPayload).eq('id', task.record_id); error = err; } 
                else if (task.action === 'DELETE') { const { error: err } = await window.db.from(task.table).delete().eq('id', task.record_id); error = err; }

                if (!error) await localDB.sync_queue.update(task.id, { status: 'completed' });
            }
            await localDB.sync_queue.where('status').equals('completed').delete();
        }

        // --- B. PROCESS OFFLINE PHOTOS ---
        const pendingPhotos = await localDB.sync_photos_queue.where('status').equals('pending').toArray();
        if (pendingPhotos.length > 0) {
            window.setStatus("syncing", `<span style="margin-right: 5px; font-weight: bold;">${pendingPhotos.length} Photos</span><div class="icon icon-cloud-arrow-up-duotone"></div>`);
            for (const photo of pendingPhotos) {
                try {
                    // Convert text back into an image file
                    const blob = window.base64ToBlob(photo.base64_data);
                    const file = new File([blob], photo.file_name, { type: blob.type });
                    await window.cacheImageDataUrl(photo.bucket, photo.file_name, photo.base64_data);

                    // Upload to Supabase Storage
                    const { error: uploadErr } = await window.db.storage.from(photo.bucket).upload(photo.file_name, file, { upsert: true, contentType: file.type || "image/jpeg" });
                    
                    if (!uploadErr) {
                        // Link the uploaded photo to the database record
                        if (photo.record_type === 'item') {
                            const { error: linkErr } = await window.db.from('photos').insert([{ item_id: photo.record_id, file_path: photo.file_name, is_primary: photo.is_primary }]);
                            if (linkErr) throw linkErr;
                        } else if (photo.record_type === 'location') {
                            await window.db.from('locations').update({ photo_path: photo.file_name }).eq('id', photo.record_id);
                        } else if (photo.record_type === 'temp_location') {
                            await window.db.from('temp_locations').update({ photo_path: photo.file_name }).eq('id', photo.record_id);
                        }
                        await localDB.sync_photos_queue.update(photo.id, { status: 'completed' });
                    }
                } catch (e) { console.error("Photo upload failed:", e); }
            }
            await localDB.sync_photos_queue.where('status').equals('completed').delete();
        }
        
        // Pull fresh data down if we changed anything
        if (pendingTasks.length > 0 || pendingPhotos.length > 0) await window.syncDatabaseToLocal();
        
    } catch (err) { console.error("Queue processing error:", err); }
};

// 8. Base64 Image Converters
window.fileToBase64 = function(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
};

window.base64ToBlob = function(base64Data) {
    const parts = base64Data.split(';'); const mime = parts[0].split(':')[1]; const bstr = atob(parts[1].split(',')[1]);
    let n = bstr.length; const u8arr = new Uint8Array(n);
    while(n--){ u8arr[n] = bstr.charCodeAt(n); }
    return new Blob([u8arr], {type: mime});
};

window.getImageCacheKey = function(bucket, fileName) {
    return `${bucket || ""}/${fileName || ""}`;
};

window.blobToDataUrl = function(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

window.compressImageFile = async function(file, options = {}) {
    const maxSize = options.maxSize || 1600;
    const quality = options.quality || 0.78;
    if (!file || !String(file.type || "").startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], `${(file.name || "photo").replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
};

window.cacheImageDataUrl = async function(bucket, fileName, dataUrl) {
    if (!bucket || !fileName || !dataUrl || !localDB.image_cache) return null;
    const key = window.getImageCacheKey(bucket, fileName);
    await localDB.image_cache.put({
        key,
        bucket,
        file_name: fileName,
        data_url: dataUrl,
        updated_at: new Date().toISOString()
    });
    return dataUrl;
};

window.cacheImageFile = async function(bucket, fileName, file) {
    if (!bucket || !fileName || !file) return null;
    const compressed = await window.compressImageFile(file);
    const dataUrl = await window.fileToBase64(compressed);
    await window.cacheImageDataUrl(bucket, fileName, dataUrl);
    return { file: compressed, dataUrl };
};

window.getCachedImageDataUrl = async function(bucket, fileName) {
    if (!bucket || !fileName || !localDB.image_cache) return null;
    const row = await localDB.image_cache.get(window.getImageCacheKey(bucket, fileName));
    return row?.data_url || null;
};

window.cacheStorageImage = async function(bucket, fileName) {
    if (!bucket || !fileName || !window.isAppOnline) return null;
    const cached = await window.getCachedImageDataUrl(bucket, fileName);
    if (cached) return cached;
    const { data, error } = await window.db.storage.from(bucket).download(fileName);
    if (error || !data) return null;
    const dataUrl = await window.blobToDataUrl(data);
    await window.cacheImageDataUrl(bucket, fileName, dataUrl);
    return dataUrl;
};

window.hydrateCachedImage = async function(imgEl, bucket, fileName, fallbackSrc) {
    if (!imgEl || !bucket || !fileName) return;
    const cached = await window.getCachedImageDataUrl(bucket, fileName);
    if (cached) {
        imgEl.src = cached;
        return;
    }
    if (!window.isAppOnline) {
        if (fallbackSrc) imgEl.src = fallbackSrc;
        return;
    }
    const publicUrl = window.db.storage.from(bucket).getPublicUrl(fileName).data.publicUrl;
    imgEl.src = publicUrl;
    window.cacheStorageImage(bucket, fileName).then(dataUrl => {
        if (dataUrl && imgEl.isConnected) imgEl.src = dataUrl;
    }).catch(error => console.warn("Image cache download failed:", bucket, fileName, error));
};

let deferredPrompt;

// 1. Capture the install prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    
    console.log("PWA Install ready. Button can be clicked.");
});

// 2. The function to call when the button is clicked
window.triggerAppInstall = async function() {
    if (deferredPrompt) {
        // Show the native install prompt
        deferredPrompt.prompt();
        
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('User accepted the install prompt');
        } else {
            console.log('User dismissed the install prompt');
        }
        
        // We can only use the prompt once, so clear it
        deferredPrompt = null;
    } else {
        alert("The app is either already installed, or your browser doesn't support installation.");
    }
};

// 3. Listen for successful installation
window.addEventListener('appinstalled', () => {
    console.log('PWA was installed successfully');
    deferredPrompt = null;
});
