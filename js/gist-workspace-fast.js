// Fast, isolated IndexedDB snapshots: editable Gist workspaces vs immutable submissions.
import manager from "./sqlite/manager.js";
import { SQLite } from "./sqlite/db.js";
import { DatabasePath } from "./db-path.js";

const DB_NAME = "sqlime-workspaces";
const DB_VERSION = 2;
const WORKSPACE_STORE = "gist-snapshots"; // Existing store; legacy SQL snapshots are migrated.
const BASE_STORE = "gist-base-snapshots";
const SNAPSHOT_DELAY_MS = 200;
const QUERY_PREFIX = "sqlime.query.";
const TABS_PREFIX = "sqlime.tabs.";

const originalInit = manager.init.bind(manager);
const originalSave = manager.save.bind(manager);
const originalExecute = SQLite.prototype.execute;
const snapshotTimers = new WeakMap();
const saving = new WeakSet();
const pendingWrites = new Map();
const invalidatedKeys = new Set();
let activeDatabase = null;
let managerInitDepth = 0;

function submissionMode() {
    return window.location.hash.startsWith("#submission=");
}

function gistKey(path) {
    return path?.type === "id" && typeof path.value === "string" &&
        /^gist:[a-z0-9]+(?:@[a-f0-9]{40})?$/i.test(path.value)
        ? path.value : "";
}

function pinnedRevision(key) {
    return /^gist:[a-z0-9]+@[a-f0-9]{40}$/i.test(key);
}

function openCache() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (!settled) { settled = true; resolve(value); }
            else value?.close?.();
        };
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const store of [WORKSPACE_STORE, BASE_STORE]) {
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store, { keyPath: "key" });
                    }
                }
            };
            request.onsuccess = () => finish(request.result);
            request.onerror = () => finish(null);
            request.onblocked = () => finish(null);
        } catch (error) {
            finish(null);
        }
    });
}

async function readSnapshot(store, key) {
    const db = await openCache();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(store, "readonly");
            const request = tx.objectStore(store).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
            tx.oncomplete = () => db.close();
            tx.onabort = () => { db.close(); resolve(null); };
        } catch (error) { db.close(); resolve(null); }
    });
}

async function writeSnapshot(store, snapshot) {
    const db = await openCache();
    if (!db) return;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put(snapshot);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); resolve(); };
        } catch (error) { db.close(); resolve(); }
    });
}

async function removeSnapshot(store, key) {
    const db = await openCache();
    if (!db) return;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); resolve(); };
        } catch (error) { db.close(); resolve(); }
    });
}

function isGistDatabase(database) {
    return Boolean(gistKey(database?.path));
}

// Serializing writes per key avoids a slower old snapshot overwriting a newer one.
// Invalidation also prevents an in-flight write from recreating a cleared cache.
async function persistSnapshot(database, store = WORKSPACE_STORE) {
    const key = gistKey(database?.path);
    if (!key || saving.has(database) ||
        (store === WORKSPACE_STORE && invalidatedKeys.has(key))) return;

    let snapshot;
    try {
        const bytes = database.capi.sqlite3_js_db_export(database.db.pointer);
        snapshot = {
            key,
            bytes: bytes.slice().buffer,
            name: database.name,
            query: database.query || "",
            id: database.id,
            gistId: database.gistId,
            revision: database.revision,
            owner: database.owner,
            baseHashcode: database.hashcode,
            updatedAt: Date.now(),
        };
    } catch (error) {
        console.warn("Could not export SQLite database for cache", error);
        return;
    }

    const writeKey = `${store}:${key}`;
    const previous = pendingWrites.get(writeKey) || Promise.resolve();
    const write = previous.catch(() => {}).then(() => {
        if (store === WORKSPACE_STORE && invalidatedKeys.has(key)) return;
        return writeSnapshot(store, snapshot);
    });
    pendingWrites.set(writeKey, write);
    try {
        await write;
    } finally {
        if (pendingWrites.get(writeKey) === write) pendingWrites.delete(writeKey);
    }
}

function scheduleSnapshot(database) {
    const previous = snapshotTimers.get(database);
    if (previous) clearTimeout(previous);
    snapshotTimers.set(database, setTimeout(() => {
        snapshotTimers.delete(database);
        persistSnapshot(database);
    }, SNAPSHOT_DELAY_MS));
}

async function restoreSnapshot(gister, path, snapshot) {
    // Accept pre-upgrade SQL snapshots once, then migrate them to binary.
    const binary = snapshot.bytes instanceof ArrayBuffer && snapshot.bytes.byteLength > 0;
    if (!binary && typeof snapshot.schema !== "string") return null;
    const localPath = binary
        ? new DatabasePath(snapshot.bytes.slice(0), "binary")
        : new DatabasePath(snapshot.schema || "-- empty local workspace", "sql");
    managerInitDepth += 1;
    try {
        const database = await originalInit(gister, snapshot.name || "", localPath);
        if (!database) return null;
        database.path = path;
        database.id = snapshot.id || path.value.replace(/^gist:/, "");
        database.gistId = snapshot.gistId || database.id.split("@")[0];
        database.revision = snapshot.revision || database.id.split("@")[1] || "";
        database.owner = snapshot.owner || null;
        database.name = snapshot.name || database.name;
        database.query = snapshot.query || "";
        database.hashcode = snapshot.baseHashcode ?? 0;
        database.gatherTables();
        database.ensureName();
        database.localWorkspaceRestored = true;
        if (!binary) await persistSnapshot(database, submissionMode() ? BASE_STORE : WORKSPACE_STORE);
        console.debug(`Restored ${path.value} from ${binary ? "SQLite binary" : "legacy SQL"} cache.`);
        return database;
    } finally {
        managerInitDepth -= 1;
    }
}

manager.init = async function (gister, name, path) {
    const key = gistKey(path);
    const immutableSubmission = Boolean(key && submissionMode());
    // Never reuse the teacher's editable Gist state for a submission.
    const store = immutableSubmission ? BASE_STORE : WORKSPACE_STORE;
    const canCache = Boolean(key && (!immutableSubmission || pinnedRevision(key)));
    if (canCache) {
        const snapshot = await readSnapshot(store, key);
        if (snapshot) {
            try {
                const restored = await restoreSnapshot(gister, path, snapshot);
                if (restored) {
                    activeDatabase = restored;
                    updateReloadButton(path);
                    return restored;
                }
            } catch (error) {
                console.warn("Invalid SQLite cache; fetching Gist", error);
            }
            await removeSnapshot(store, key);
        }
    }

    managerInitDepth += 1;
    try {
        const database = await originalInit(gister, name, path);
        if (database && isGistDatabase(database) && canCache) {
            await persistSnapshot(database, store);
        }
        activeDatabase = database;
        updateReloadButton(database?.path || null);
        return database;
    } finally {
        managerInitDepth -= 1;
    }
};

manager.save = async function (gister, database, query) {
    saving.add(database);
    let savedDatabase;
    try {
        savedDatabase = await originalSave(gister, database, query);
    } finally {
        saving.delete(database);
    }
    if (savedDatabase && isGistDatabase(savedDatabase)) {
        await persistSnapshot(savedDatabase);
        activeDatabase = savedDatabase;
        updateReloadButton(savedDatabase.path);
    }
    return savedDatabase;
};

function definitelyReadOnly(sql) {
    const query = String(sql || "").trim().replace(/;\s*$/, "");
    // Conservative: any multiple-statement or non-SELECT SQL is snapshotted.
    return /^SELECT\b/i.test(query) && !query.includes(";");
}

SQLite.prototype.execute = function (sql, updateQuery = true) {
    let result;
    try {
        result = originalExecute.call(this, sql, updateQuery);
    } catch (error) {
        // SQLite can apply an earlier statement before a later statement fails.
        if (updateQuery !== false && managerInitDepth === 0 &&
            !saving.has(this) && isGistDatabase(this) && !submissionMode()) {
            scheduleSnapshot(this);
        }
        throw error;
    }
    if (updateQuery !== false && managerInitDepth === 0 &&
        !saving.has(this) && isGistDatabase(this) &&
        !submissionMode() && !definitelyReadOnly(sql)) {
        scheduleSnapshot(this);
    }
    return result;
};

function currentGistKey() {
    let hash = window.location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch (error) { /* Keep original. */ }
    return gistKey(new DatabasePath(hash, "id"));
}

function ensureReloadButton() {
    const commandbar = document.querySelector("#commandbar");
    if (!commandbar) return null;
    let button = commandbar.querySelector("#reload-gist");
    if (!button) {
        button = document.createElement("button");
        button.id = "reload-gist";
        button.type = "button";
        button.title = "Discard local changes and fetch this Gist from GitHub";
        button.innerHTML = `↻ <span class="hidden-mobile">gist</span>`;
        button.addEventListener("click", reloadFromGist);
        commandbar.appendChild(button);
    }
    return button;
}

function updateReloadButton(path) {
    const button = ensureReloadButton();
    if (!button) return;
    const key = submissionMode() ? "" : (path === null ? "" : gistKey(path) || currentGistKey());
    button.hidden = !key;
    button.style.display = key ? "" : "none";
    button.dataset.workspaceKey = key;
}

async function reloadFromGist(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    const key = button.dataset.workspaceKey || currentGistKey();
    if (!key || submissionMode()) return;
    button.disabled = true;
    invalidatedKeys.add(key);

    if (gistKey(activeDatabase?.path) === key) {
        const timer = snapshotTimers.get(activeDatabase);
        if (timer) clearTimeout(timer);
        snapshotTimers.delete(activeDatabase);
    }
    const write = pendingWrites.get(`${WORKSPACE_STORE}:${key}`);
    if (write) await write.catch(() => {});
    const snapshot = await readSnapshot(WORKSPACE_STORE, key);
    await removeSnapshot(WORKSPACE_STORE, key);
    if (pinnedRevision(key)) await removeSnapshot(BASE_STORE, key);
    const cacheName = snapshot?.name || activeDatabase?.name;
    if (cacheName) {
        try {
            localStorage.removeItem(`${QUERY_PREFIX}${cacheName}`);
            localStorage.removeItem(`${TABS_PREFIX}${cacheName}`);
        } catch (error) { /* Storage may be unavailable. */ }
    }
    window.location.reload();
}

// Best effort for navigation/reload soon after a mutating SQL statement.
// IndexedDB writes cannot be guaranteed once a browser kills the page.
function flushPendingSnapshot() {
    if (!activeDatabase || !isGistDatabase(activeDatabase) || submissionMode()) return;
    const timer = snapshotTimers.get(activeDatabase);
    if (!timer) return;
    clearTimeout(timer);
    snapshotTimers.delete(activeDatabase);
    persistSnapshot(activeDatabase);
}

window.addEventListener("pagehide", flushPendingSnapshot);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingSnapshot();
});

customElements.whenDefined("command-bar").then(() => {
    queueMicrotask(() => updateReloadButton());
});
window.addEventListener("popstate", () => updateReloadButton());
