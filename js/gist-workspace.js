import manager from "./sqlite/manager.js";
import dumper from "./sqlite/dumper.js";
import { SQLite } from "./sqlite/db.js";
import { DatabasePath } from "./db-path.js";

const DB_NAME = "sqlime-workspaces";
const DB_VERSION = 1;
const STORE_NAME = "gist-snapshots";
const SNAPSHOT_DELAY_MS = 200;
const QUERY_PREFIX = "sqlime.query.";
const TABS_PREFIX = "sqlime.tabs.";

const originalInit = manager.init.bind(manager);
const originalSave = manager.save.bind(manager);
const originalExecute = SQLite.prototype.execute;

const snapshotTimers = new WeakMap();
const snapshotting = new WeakSet();
const saving = new WeakSet();
let managerInitDepth = 0;

function openWorkspaceDb() {
    if (!("indexedDB" in window)) {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "key" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

async function getSnapshot(key) {
    const db = await openWorkspaceDb();
    if (!db) {
        return null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
        tx.onerror = () => db.close();
    });
}

async function putSnapshot(snapshot) {
    const db = await openWorkspaceDb();
    if (!db) {
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(snapshot);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            resolve();
        };
    });
}

async function deleteSnapshot(key) {
    const db = await openWorkspaceDb();
    if (!db) {
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            resolve();
        };
    });
}

function isGistDatabase(database) {
    return Boolean(
        database &&
            database.path &&
            database.path.type == "id" &&
            typeof database.path.value == "string" &&
            database.path.value.startsWith("gist:")
    );
}

async function persistSnapshot(database) {
    if (!isGistDatabase(database) || snapshotting.has(database) || saving.has(database)) {
        return;
    }

    snapshotting.add(database);
    const query = database.query || "";
    const baseHashcode = database.hashcode;
    try {
        const schema = dumper.toSql(database);
        database.query = query;
        await putSnapshot({
            key: database.path.value,
            schema,
            query,
            name: database.name,
            id: database.id,
            owner: database.owner,
            baseHashcode,
            updatedAt: Date.now(),
        });
    } catch (error) {
        console.warn("Could not store local Gist workspace", error);
    } finally {
        database.query = query;
        snapshotting.delete(database);
    }
}

function scheduleSnapshot(database) {
    const previous = snapshotTimers.get(database);
    if (previous) {
        clearTimeout(previous);
    }
    const timer = setTimeout(() => {
        snapshotTimers.delete(database);
        persistSnapshot(database);
    }, SNAPSHOT_DELAY_MS);
    snapshotTimers.set(database, timer);
}

async function restoreSnapshot(gister, path, snapshot) {
    const localPath = new DatabasePath(snapshot.schema || "-- empty local workspace", "sql");
    managerInitDepth += 1;
    try {
        const database = await originalInit(gister, snapshot.name || "", localPath);
        if (!database) {
            return null;
        }
        database.path = path;
        database.id = snapshot.id || path.value.replace(/^gist:/, "");
        database.owner = snapshot.owner || null;
        database.name = snapshot.name || database.name;
        database.query = snapshot.query || "";
        database.hashcode = snapshot.baseHashcode ?? 0;
        database.gatherTables();
        database.ensureName();
        database.localWorkspaceRestored = true;
        console.debug(`Loaded ${path.value} from local workspace cache.`);
        return database;
    } finally {
        managerInitDepth -= 1;
    }
}

manager.init = async function (gister, name, path) {
    if (path && path.type == "id" && typeof path.value == "string" && path.value.startsWith("gist:")) {
        const snapshot = await getSnapshot(path.value);
        if (snapshot) {
            try {
                const restored = await restoreSnapshot(gister, path, snapshot);
                if (restored) {
                    updateReloadButton(path);
                    return restored;
                }
            } catch (error) {
                console.warn("Local Gist workspace is invalid; loading from Gist instead.", error);
                await deleteSnapshot(path.value);
            }
        }
    }

    managerInitDepth += 1;
    try {
        const database = await originalInit(gister, name, path);
        if (database && isGistDatabase(database)) {
            await persistSnapshot(database);
            updateReloadButton(database.path);
        } else {
            updateReloadButton(null);
        }
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

SQLite.prototype.execute = function (sql, updateQuery = true) {
    const result = originalExecute.call(this, sql, updateQuery);
    if (
        updateQuery !== false &&
        managerInitDepth == 0 &&
        !snapshotting.has(this) &&
        !saving.has(this) &&
        isGistDatabase(this)
    ) {
        scheduleSnapshot(this);
    }
    return result;
};

function currentGistKey() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) {
        return "";
    }
    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch (error) {
    }
    if (/^gist:[a-z0-9]+$/i.test(decoded)) {
        return decoded;
    }
    return "";
}

function ensureReloadButton() {
    const commandbar = document.querySelector("#commandbar");
    if (!commandbar) {
        return null;
    }

    let button = commandbar.querySelector("#reload-gist");
    if (!button) {
        button = document.createElement("button");
        button.id = "reload-gist";
        button.type = "button";
        button.title = "Discard local changes and reload the database from GitHub Gist";
        button.innerHTML = `↻ <span class="hidden-mobile">gist</span>`;
        button.addEventListener("click", reloadFromGist);
        commandbar.appendChild(button);
    }
    return button;
}

function updateReloadButton(path = null) {
    const button = ensureReloadButton();
    if (!button) {
        return;
    }
    const key = path && path.type == "id" ? path.value : currentGistKey();
    const isGist = typeof key == "string" && key.startsWith("gist:");
    button.hidden = !isGist;
    button.style.display = isGist ? "" : "none";
    button.dataset.workspaceKey = isGist ? key : "";
}

async function reloadFromGist(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const key = button.dataset.workspaceKey || currentGistKey();
    if (!key) {
        return;
    }

    button.disabled = true;
    const snapshot = await getSnapshot(key);
    await deleteSnapshot(key);

    if (snapshot && snapshot.name) {
        try {
            localStorage.removeItem(`${QUERY_PREFIX}${snapshot.name}`);
            localStorage.removeItem(`${TABS_PREFIX}${snapshot.name}`);
        } catch (error) {
        }
    }

    window.location.reload();
}

customElements.whenDefined("command-bar").then(() => {
    queueMicrotask(() => updateReloadButton());
});
window.addEventListener("popstate", () => updateReloadButton());
