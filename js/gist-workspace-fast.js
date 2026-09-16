// Fast, isolated IndexedDB snapshots: editable Gist workspaces vs immutable submissions.
import manager from "./sqlite/manager.js";
import { SQLite } from "./sqlite/db.js";
import { DatabasePath } from "./db-path.js";

const DB_NAME = "sqlime-workspaces";
const DB_VERSION = 2;
const WORKSPACE_STORE = "gist-snapshots"; // Existing store; legacy SQL snapshots are migrated.
const BASE_STORE = "gist-base-snapshots";
const SNAPSHOT_DELAY_MS = 600;
const QUERY_PREFIX = "sqlime.query.";
const TABS_PREFIX = "sqlime.tabs.";

const originalInit = manager.init.bind(manager);
const originalSave = manager.save.bind(manager);
const originalExecute = SQLite.prototype.execute;
const snapshotTimers = new WeakMap();
const snapshotting = new WeakSet();
const saving = new WeakSet();
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

async function persistSnapshot(database, store = WORKSPACE_STORE) {
    if (!isGistDatabase(database) || snapshotting.has(database) || saving.has(database)) return;
    snapshotting.add(database);
    try {
        // Export real SQLite pages. Replaying thousands of INSERT statements is much slower.
        const bytes = database.capi.sqlite3_js_db_export(database.db.pointer);
        await writeSnapshot(store, {
            key: database.path.value,
            bytes: bytes.slice().buffer,
            name: database.name,
            query: database.query || "",
            id: database.id,
            gistId: database.gistId,
            revision: database.revision,
            owner: database.owner,
            baseHashcode: database.hashcode,
            updatedAt: Date.now(),
        });
    } catch (error) {
        console.warn("Could not cache SQLite database", error);
    } finally {
        snapshotting.delete(database);
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
    // Pinned submissions can share a read-only base cache. Unpinned legacy links
    // must fetch GitHub rather than accidentally showing a locally edited workspace.
    const store = immutableSubmission ? BASE_STORE : WORKSPACE_STORE;
    const canCache = Boolean(key && (!immutableSubmission || pinnedRevision(key)));
    if (canCache) {
        const snapshot = await readSnapshot(store, key);
        if (snapshot) {
            try {
                const restored = await restoreSnapshot(gister, path, snapshot);
                if (restored) { updateReloadButton(path); return restored; }
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
    const result = originalExecute.call(this, sql, updateQuery);
    if (updateQuery !== false && managerInitDepth === 0 &&
        !snapshotting.has(this) && !saving.has(this) &&
        isGistDatabase(this) && !submissionMode() && !definitelyReadOnly(sql)) {
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
    const timer = snapshotTimers.get(window.app?.database);
    if (timer) clearTimeout(timer);
    const snapshot = await readSnapshot(WORKSPACE_STORE, key);
    await removeSnapshot(WORKSPACE_STORE, key);
    if (pinnedRevision(key)) await removeSnapshot(BASE_STORE, key);
    if (snapshot?.name) {
        try {
            localStorage.removeItem(`${QUERY_PREFIX}${snapshot.name}`);
            localStorage.removeItem(`${TABS_PREFIX}${snapshot.name}`);
        } catch (error) { /* Storage may be unavailable. */ }
    }
    window.location.reload();
}

customElements.whenDefined("command-bar").then(() => {
    queueMicrotask(() => updateReloadButton());
});
window.addEventListener("popstate", () => updateReloadButton());
