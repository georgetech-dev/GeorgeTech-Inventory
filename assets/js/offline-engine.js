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
    audit_logs: 'id, created_at, action_type' // <--- NEW LINE
});

// Global state tracker
window.isAppOnline = navigator.onLine;

// 2. Global Network Listeners
function initOfflineEngine() {
    console.log("🌐 Offline Engine Initialized. Local DB Ready.");
    
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('../sw.js').then(registration => {
                console.log('🛠️ ServiceWorker registration successful with scope: ', registration.scope);
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

// 3. Status Pill Controller
function updateNetworkUI(isOnline) {
    const statusBox = document.querySelector('.status-indicator');
    if (!statusBox) return;

    if (isOnline) {
        statusBox.style.background = "#22c55e"; // Green
        statusBox.textContent = "Online - Synced";
    } else {
        statusBox.style.background = "#ef4444"; // Red
        statusBox.textContent = "Offline - Saving Locally";
    }
}

// Global helper for system messages (Strict Offline-Enforcement)
window.setStatus = function(mode, msg) {
    const statusBox = document.querySelector('.status-indicator');
    if (!statusBox) return;

    // Strict override: Never show green/connected if physically offline!
    if (!window.isAppOnline && mode === "connected") {
        mode = "error";
        msg = "Offline - Saving Locally";
    }

    if (mode === "syncing") statusBox.style.background = "#ff8c00"; // Orange
    else if (mode === "error") statusBox.style.background = "#ef4444"; // Red
    else statusBox.style.background = "#22c55e"; // Green

    statusBox.textContent = msg;
}

// 5. Global Data Down-Sync (Downloads Supabase -> Saves to Dexie)
window.syncDatabaseToLocal = async function() {
    if (!window.isAppOnline) return; // Abort if offline

    window.setStatus("syncing", "Downloading database...");
    
    try {
        console.log("🔄 Starting Down-Sync...");

        // 1. Sync Items
        const { data: itemsData, error: itemsErr } = await window.db.from('items').select('*, photos(file_path, is_primary)');
        if (!itemsErr && itemsData) {
            await localDB.items.clear();
            await localDB.items.bulkPut(itemsData);
            console.log(`📥 Synced ${itemsData.length} Items`);
        } else { console.warn("⚠️ Items sync failed:", itemsErr); }

        // 2. Sync Locations
        const { data: locData, error: locErr } = await window.db.from('locations').select('*');
        if (!locErr && locData) {
            await localDB.locations.clear();
            await localDB.locations.bulkPut(locData);
            console.log(`📥 Synced ${locData.length} Locations`);
        } else { console.warn("⚠️ Locations sync failed:", locErr); }

        // 3. Sync Assignees (Temp Locations)
        const { data: tempData, error: tempErr } = await window.db.from('temp_locations').select('*');
        if (!tempErr && tempData) {
            await localDB.temp_locations.clear();
            await localDB.temp_locations.bulkPut(tempData);
            console.log(`📥 Synced ${tempData.length} Assignees`);
        } else { console.warn("⚠️ Assignees sync failed:", tempErr); }

        // 4. Sync Tags
        const { data: tagData, error: tagErr } = await window.db.from('tags').select('*');
        if (!tagErr && tagData) {
            await localDB.tags.clear();
            await localDB.tags.bulkPut(tagData);
            console.log(`📥 Synced ${tagData.length} Tags`);
        } else { console.warn("⚠️ Tags sync failed:", tagErr); }

        // 5. Sync Categories
        const { data: catData, error: catErr } = await window.db.from('item_categories').select('*');
        if (!catErr && catData) {
            await localDB.item_categories.clear();
            await localDB.item_categories.bulkPut(catData);
            console.log(`📥 Synced ${catData.length} Categories`);
        } else { console.warn("⚠️ Categories sync failed:", catErr); }

        // 6. Sync Audit Logs (Limit to 200 so we don't overload the phone)
        const { data: auditData, error: auditErr } = await window.db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
        if (!auditErr && auditData) {
            await localDB.audit_logs.clear();
            await localDB.audit_logs.bulkPut(auditData);
            console.log(`📥 Synced ${auditData.length} Audit Logs`);
        } else { console.warn("⚠️ Audit Logs sync failed:", auditErr); }


        console.log("✅ Offline Database fully synced with Supabase!");
        window.setStatus("connected", "Online - Synced");

        // Tell the UI to refresh its arrays now that we have fresh data
        if (typeof refreshAllDataFromLocal === "function") refreshAllDataFromLocal();

    } catch (err) {
        console.error("Down-sync failed critically:", err);
        window.setStatus("error", "Sync Failed");
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

// 6. Universal Offline Writer (Upgraded with Client-Side UUIDs)
window.offlineSafeWrite = async function(action, table, payload, recordId = null) {
    try {
        let finalId = recordId;
        let localPayload = sanitizeSyncPayload(table, payload);
        
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

// 7. The Queue Processor (Upgraded with Photo Sync)
window.processSyncQueue = async function() {
    if (!window.isAppOnline) { window.setStatus("error", "Offline - Changes Saved Locally"); return; }
    
    try {
        // --- A. PROCESS NORMAL DATA ---
        const pendingTasks = await localDB.sync_queue.where('status').equals('pending').toArray();
        if (pendingTasks.length > 0) {
            window.setStatus("syncing", `Syncing ${pendingTasks.length} data changes...`);
            for (const task of pendingTasks) {
                let error = null;
                const syncPayload = sanitizeSyncPayload(task.table, task.payload);

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
            window.setStatus("syncing", `Uploading ${pendingPhotos.length} photos...`);
            for (const photo of pendingPhotos) {
                try {
                    // Convert text back into an image file
                    const blob = window.base64ToBlob(photo.base64_data);
                    const file = new File([blob], photo.file_name, { type: blob.type });

                    // Upload to Supabase Storage
                    const { error: uploadErr } = await window.db.storage.from(photo.bucket).upload(photo.file_name, file);
                    
                    if (!uploadErr) {
                        // Link the uploaded photo to the database record
                        if (photo.record_type === 'item') {
                            await window.db.from('photos').insert([{ item_id: photo.record_id, file_path: photo.file_name, is_primary: photo.is_primary }]);
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

let deferredPrompt;

// 1. Capture the install prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    
    // Optional: Show your custom install button
    // e.g., document.getElementById('installAppBtn').style.display = 'block';
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
            // Hide the button once installed
            // document.getElementById('installAppBtn').style.display = 'none';
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
    // Hide the button permanently
    deferredPrompt = null;
});
