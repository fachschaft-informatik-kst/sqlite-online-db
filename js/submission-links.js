// Link-based Moodle submissions.
//
// Public GitHub Gists are the preferred database registry: when a database is
// saved as a Gist, its Gist ID becomes the stable source identifier used by
// submission links. A small static registry remains supported as a fallback
// for locally distributed classroom databases.

import manager from "./sqlite/manager.js";
import storage from "./storage.js";
import { DatabasePath } from "./db-path.js";

const REGISTRY_URL = new URL("../databases/databases.json", import.meta.url);
const SUBMISSION_PREFIX = "submission=";
const MAX_SUBMISSION_URL_LENGTH = 60000;
const STUDENT_MODE_PARAM = "student";

const originalManagerInit = manager.init.bind(manager);
const originalManagerSave = manager.save.bind(manager);
const originalStorageGet = storage.get.bind(storage);
const originalStorageGetTabs = storage.getTabs.bind(storage);

let registryPromise = null;
let identificationPromise = Promise.resolve(null);
let currentDatabaseId = "";
let currentDatabaseEntry = null;
let pendingSubmission = null;
let pendingDatabaseName = "";
let pendingTabsServed = false;

function isSubmissionPath(path) {
    return Boolean(
        path &&
            typeof path.value == "string" &&
            path.value.startsWith(SUBMISSION_PREFIX)
    );
}

function isGistDatabaseId(value) {
    return typeof value == "string" && value.startsWith("gist:");
}

async function loadRegistry() {
    if (!registryPromise) {
        registryPromise = fetch(REGISTRY_URL, { cache: "no-cache" })
            .then((response) => (response.ok ? response.json() : { databases: {} }))
            .then((registry) => registry.databases || {})
            .catch(() => ({}));
    }
    return registryPromise;
}

async function digestHex(algorithm, buffer) {
    const digest = await crypto.subtle.digest(algorithm, buffer);
    return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

function sha256(buffer) {
    return digestHex("SHA-256", buffer);
}

async function gitBlobSha1(buffer) {
    const bytes = new Uint8Array(buffer);
    const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const combined = new Uint8Array(prefix.length + bytes.length);
    combined.set(prefix);
    combined.set(bytes, prefix.length);
    return digestHex("SHA-1", combined.buffer);
}

function clearDatabaseIdentification() {
    currentDatabaseId = "";
    currentDatabaseEntry = null;
}

function setGistIdentification(database) {
    if (!database || !database.id) {
        return false;
    }
    currentDatabaseId = `gist:${database.id}`;
    currentDatabaseEntry = {
        name: database.name || "database.db",
        title: database.meaningfulName || database.name || "Gist database",
        format: "gist",
    };
    return true;
}

function findByField(registry, field, value) {
    for (const [id, entry] of Object.entries(registry)) {
        if (entry && entry[field] === value) {
            return { id, entry };
        }
    }
    return null;
}

async function identifyDatabaseFile(file) {
    if (!file || !/\.(db|sqlite|sqlite3)$/i.test(file.name || "")) {
        clearDatabaseIdentification();
        return null;
    }

    const buffer = await file.arrayBuffer();
    const registry = await loadRegistry();
    const hash = await sha256(buffer);
    let match = findByField(registry, "sha256", hash);

    if (!match) {
        const gitHash = await gitBlobSha1(buffer);
        match = findByField(registry, "gitSha1", gitHash);
    }

    if (!match) {
        clearDatabaseIdentification();
        return null;
    }

    currentDatabaseId = match.id;
    currentDatabaseEntry = match.entry;
    return match.entry;
}

async function identifyDatabasePath(path) {
    if (!path || !["local", "remote"].includes(path.type) || typeof path.value != "string") {
        return null;
    }

    const targetUrl = new URL(path.value, document.baseURI).href;
    const registry = await loadRegistry();
    for (const [id, entry] of Object.entries(registry)) {
        if (!entry || !entry.source) {
            continue;
        }
        const sourceUrl = new URL(`../${entry.source}`, import.meta.url).href;
        if (sourceUrl == targetUrl) {
            currentDatabaseId = id;
            currentDatabaseEntry = entry;
            return entry;
        }
    }
    return null;
}

function bytesToBase64Url(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/g, "");
}

function base64ToBytes(value) {
    const base64 = value
        .replace(/\s+/g, "")
        .replaceAll("-", "+")
        .replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function gzip(bytes) {
    if (typeof CompressionStream != "function") {
        return null;
    }
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
    if (typeof DecompressionStream != "function") {
        throw new Error("This browser cannot decompress submission links.");
    }
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeSubmission(payload) {
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzip(raw);
    if (compressed && compressed.length < raw.length) {
        return `g.${bytesToBase64Url(compressed)}`;
    }
    return `j.${bytesToBase64Url(raw)}`;
}

function normalizeSubmissionPayload(payload) {
    if (
        payload &&
        payload.v === 1 &&
        typeof payload.d == "string" &&
        Array.isArray(payload.q) &&
        payload.q.length
    ) {
        const tabs = payload.q.map((item, index) => {
            if (
                !Array.isArray(item) ||
                typeof item[0] != "string" ||
                typeof item[1] != "string"
            ) {
                throw new Error("Submission contains an invalid SQL tab.");
            }
            return {
                id: `submission-${index + 1}`,
                name: item[0],
                sql: item[1],
            };
        });
        const activeIndex = Number.isInteger(payload.a) ? payload.a : 0;
        const safeActiveIndex = Math.max(0, Math.min(activeIndex, tabs.length - 1));
        return {
            db: payload.d,
            tabs,
            active: tabs[safeActiveIndex].id,
        };
    }

    // Backward compatibility with the first PR revision.
    if (
        payload &&
        payload.v === 1 &&
        typeof payload.db == "string" &&
        Array.isArray(payload.tabs) &&
        payload.tabs.length
    ) {
        return {
            db: payload.db,
            tabs: payload.tabs.map((tab) => ({ ...tab })),
            active: payload.active,
        };
    }

    throw new Error("Invalid submission payload.");
}

async function decodeSubmission(encoded) {
    const separator = encoded.indexOf(".");
    if (separator < 1) {
        throw new Error("Invalid submission link.");
    }
    const format = encoded.slice(0, separator);
    let bytes = base64ToBytes(encoded.slice(separator + 1));
    if (format == "g") {
        bytes = await gunzip(bytes);
    } else if (format != "j") {
        throw new Error("Unsupported submission link version.");
    }
    return normalizeSubmissionPayload(
        JSON.parse(new TextDecoder().decode(bytes))
    );
}

async function loadRegistryDatabase(gister, entry) {
    if (!entry || !entry.source) {
        throw new Error("Registered database has no source.");
    }

    const sourceUrl = new URL(`../${entry.source}`, import.meta.url);

    if (entry.format == "sqlite-gzip-base64") {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Could not load classroom database (${response.status}).`);
        }
        const encoded = await response.text();
        const databaseBytes = await gunzip(base64ToBytes(encoded));
        if (entry.sha256) {
            const actualHash = await sha256(databaseBytes.buffer);
            if (actualHash !== entry.sha256) {
                throw new Error("Classroom database failed its integrity check.");
            }
        }
        return originalManagerInit(
            gister,
            entry.name || "submission.db",
            new DatabasePath(databaseBytes.buffer, "binary")
        );
    }

    if (entry.format == "sql-gzip") {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`Could not load classroom database (${response.status}).`);
        }
        const compressed = new Uint8Array(await response.arrayBuffer());
        const sql = new TextDecoder().decode(await gunzip(compressed));
        return originalManagerInit(
            gister,
            entry.name || "submission.db",
            new DatabasePath(sql, "sql")
        );
    }

    return originalManagerInit(
        gister,
        entry.name || "submission.db",
        new DatabasePath(sourceUrl.href, "remote")
    );
}

async function loadSubmissionDatabase(gister, databaseId) {
    if (isGistDatabaseId(databaseId)) {
        return originalManagerInit(
            gister,
            "",
            new DatabasePath(databaseId, "id")
        );
    }

    const registry = await loadRegistry();
    let entry = registry[databaseId];
    let resolvedId = databaseId;

    if (!entry) {
        const legacyHash = databaseId.startsWith("git:")
            ? { field: "gitSha1", value: databaseId.slice(4) }
            : { field: "sha256", value: databaseId };
        const match = findByField(registry, legacyHash.field, legacyHash.value);
        if (match) {
            resolvedId = match.id;
            entry = match.entry;
        }
    }

    if (!entry) {
        throw new Error("The database used for this submission is not available.");
    }

    const database = await loadRegistryDatabase(gister, entry);
    database.submissionDatabaseId = resolvedId;
    return database;
}

function activeSubmissionSql(payload) {
    const active = payload.tabs.find((tab) => tab.id == payload.active);
    return (active || payload.tabs[0]).sql || "";
}

function scheduleSubmissionUiRestore(payload, title) {
    setTimeout(() => {
        const app = window.app;
        if (!app || !app.ui) {
            return;
        }

        const tab = payload.active
            ? app.ui.queryTabs.querySelector(
                  `[data-query-tab-id="${CSS.escape(payload.active)}"]`
              )
            : null;
        if (tab && app.state.activeQueryTabId != payload.active) {
            tab.click();
        }

        app.ui.status.success(
            `Submission loaded: ${escapeHtml(title)} · ${payload.tabs.length} SQL ${payload.tabs.length == 1 ? "tab" : "tabs"}`
        );
        pendingSubmission = null;
        pendingDatabaseName = "";
    }, 0);
}

manager.init = async function (gister, name, path) {
    if (isSubmissionPath(path)) {
        const payload = await decodeSubmission(
            path.value.slice(SUBMISSION_PREFIX.length)
        );
        pendingSubmission = payload;
        pendingTabsServed = false;

        const database = await loadSubmissionDatabase(gister, payload.db);
        if (!database) {
            throw new Error("Could not reconstruct the submission database.");
        }

        pendingDatabaseName = database.name || "submission.db";
        database.query = activeSubmissionSql(payload);
        database.path = path;

        if (isGistDatabaseId(payload.db)) {
            currentDatabaseId = payload.db;
            currentDatabaseEntry = {
                name: database.name,
                title: database.meaningfulName || database.name || "Gist database",
                format: "gist",
            };
        } else {
            currentDatabaseId = database.submissionDatabaseId || payload.db;
            const registry = await loadRegistry();
            currentDatabaseEntry = registry[currentDatabaseId] || {
                name: database.name,
                title: database.name,
            };
        }

        scheduleSubmissionUiRestore(
            payload,
            currentDatabaseEntry.title || currentDatabaseEntry.name || "database"
        );
        return database;
    }

    if (path && ["local", "remote"].includes(path.type)) {
        identificationPromise = identifyDatabasePath(path).catch(() => null);
        await identificationPromise;
    } else if (!path || !["binary", "id"].includes(path.type)) {
        clearDatabaseIdentification();
        identificationPromise = Promise.resolve(null);
    }

    const database = await originalManagerInit(gister, name, path);
    if (path && path.type == "id" && database) {
        setGistIdentification(database);
    }
    return database;
};

// Creating or updating a public Gist automatically registers that Gist as the
// submission database. No databases.json edit is required.
manager.save = async function (gister, database, query) {
    const savedDatabase = await originalManagerSave(gister, database, query);
    if (savedDatabase) {
        setGistIdentification(savedDatabase);
    }
    return savedDatabase;
};

storage.get = function (key) {
    if (pendingSubmission && key == pendingDatabaseName) {
        return null;
    }
    return originalStorageGet(key);
};

storage.getTabs = function (key) {
    if (pendingSubmission && !pendingTabsServed && key == pendingDatabaseName) {
        pendingTabsServed = true;
        return pendingSubmission.tabs.map((tab) => ({ ...tab }));
    }
    return originalStorageGetTabs(key);
};

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function ensureSubmitButton() {
    const commandbar = document.querySelector("#commandbar");
    if (!commandbar || commandbar.querySelector("#submit-submission")) {
        return;
    }

    const button = document.createElement("button");
    button.id = "submit-submission";
    button.type = "button";
    button.title = "Create a Moodle submission link";
    button.innerHTML = `
<svg viewBox="0 0 24 24" role="img" aria-hidden="true">
    <path fill="currentColor" d="M3.4 20.4 20.8 13c1.6-.7 1.6-1.7 0-2.4L3.4 3.2c-1.3-.6-2.1.1-1.8 1.5l1.5 6.1 10 1.2-10 1.2-1.5 6.1c-.3 1.4.5 2.1 1.8 1.1Z" />
</svg>
<span class="hidden-mobile">submit</span>`;

    const save = commandbar.querySelector("#save");
    if (save) {
        save.insertAdjacentElement("afterend", button);
    } else {
        commandbar.appendChild(button);
    }
}

function applyStudentMode() {
    if (new URLSearchParams(window.location.search).get(STUDENT_MODE_PARAM) != "1") {
        return;
    }

    document.querySelector('#toolbar a[href="settings.html"]')?.remove();
    for (const selector of ["#save", "#ask-ai"]) {
        const element = document.querySelector(selector);
        if (element) {
            element.hidden = true;
            element.style.display = "none";
        }
    }
}

function snapshotQueryTabs() {
    const app = window.app;
    if (!app || !app.state || !app.ui) {
        return null;
    }

    const tabs = app.state.queryTabs.map((tab) => ({ ...tab }));
    const active = tabs.find((tab) => tab.id == app.state.activeQueryTabId);
    if (active) {
        active.sql = app.ui.editor.value;
    }
    return {
        tabs,
        activeIndex: Math.max(
            0,
            tabs.findIndex((tab) => tab.id == app.state.activeQueryTabId)
        ),
    };
}

async function writeClipboard(value) {
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch (error) {
        return false;
    }
}

async function createSubmissionLink(button) {
    const app = window.app;
    if (!app || !app.ui) {
        return;
    }

    button.disabled = true;
    try {
        await identificationPromise;
        if (!currentDatabaseId || !currentDatabaseEntry) {
            app.ui.status.error(
                "This database is not registered for submissions. Open it from a public Gist or use a registered classroom database."
            );
            return;
        }

        const snapshot = snapshotQueryTabs();
        if (!snapshot || !snapshot.tabs.length) {
            app.ui.status.error("No SQL query tabs found.");
            return;
        }

        const payload = {
            v: 1,
            d: currentDatabaseId,
            a: snapshot.activeIndex,
            q: snapshot.tabs.map((tab) => [tab.name, tab.sql]),
        };
        const encoded = await encodeSubmission(payload);
        const url = new URL(window.location.href);
        url.search = "";
        url.hash = `${SUBMISSION_PREFIX}${encoded}`;
        const shareUrl = url.href;

        if (shareUrl.length > MAX_SUBMISSION_URL_LENGTH) {
            app.ui.status.error(
                `Submission link is too large (${Math.round(shareUrl.length / 1000)}k characters). Maximum is ${Math.round(MAX_SUBMISSION_URL_LENGTH / 1000)}k.`
            );
            return;
        }

        const copied = await writeClipboard(shareUrl);
        window.app.lastSubmissionUrl = shareUrl;
        const sourceLabel = isGistDatabaseId(currentDatabaseId)
            ? "public Gist"
            : currentDatabaseEntry.title || currentDatabaseEntry.name;
        if (copied) {
            app.ui.status.success(
                `✓ Submission link copied · ${escapeHtml(sourceLabel)} · ${snapshot.tabs.length} SQL ${snapshot.tabs.length == 1 ? "tab" : "tabs"}`
            );
        } else {
            window.prompt("Copy this submission link into Moodle:", shareUrl);
            app.ui.status.success("✓ Submission link created");
        }
    } catch (error) {
        app.ui.status.error(error instanceof Error ? error.message : String(error));
    } finally {
        button.disabled = false;
    }
}

// Local file uploads can still use the optional static registry. `open-file`
// is a non-bubbling event, so listen directly on the toolbar element.
const toolbar = document.querySelector("#toolbar");
if (toolbar) {
    toolbar.addEventListener("open-file", (event) => {
        identificationPromise = identifyDatabaseFile(event.detail).catch((error) => {
            console.warn("Could not identify classroom database", error);
            clearDatabaseIdentification();
            return null;
        });
    });
}

document.addEventListener(
    "click",
    (event) => {
        const button = event.target.closest("#submit-submission");
        if (!button) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        createSubmissionLink(button);
    },
    true
);

customElements.whenDefined("command-bar").then(() => {
    queueMicrotask(() => {
        ensureSubmitButton();
        applyStudentMode();
    });
});
