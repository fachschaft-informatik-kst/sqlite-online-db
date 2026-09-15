// Query tab name UX enhancements.
// Keeps the existing tab state/rendering in index.js and adds direct filename editing.
// Also reconciles submission tab contents after app initialization so multi-tab
// Moodle submissions restore deterministically.

const MAX_QUERY_FILE_NAME_LENGTH = 36;
const DEFAULT_QUERY_NAME_PATTERN = /^Query\s+(\d+)$/;
const SUBMISSION_PREFIX = "submission=";

const queryTabs = document.querySelector("#query-tabs");

function appState() {
    return window.app && window.app.state ? window.app.state : null;
}

function activeTab() {
    const state = appState();
    if (!state) {
        return null;
    }
    return state.queryTabs.find((tab) => tab.id == state.activeQueryTabId) || null;
}

function syncActiveTabSql() {
    const state = appState();
    const app = window.app;
    if (!state || !app || !app.ui || !app.ui.editor) {
        return;
    }
    const tab = state.queryTabs.find((item) => item.id == state.activeQueryTabId);
    if (tab) {
        tab.sql = app.ui.editor.value;
    }
}

function migrateDefaultNames() {
    const state = appState();
    if (!state) {
        return false;
    }

    let changed = false;
    for (const tab of state.queryTabs) {
        const match = String(tab.name || "").match(DEFAULT_QUERY_NAME_PATTERN);
        if (match) {
            tab.name = `query${match[1]}`;
            changed = true;
        }
    }
    return changed;
}

function configureActiveNameInput() {
    const migrated = migrateDefaultNames();
    const tab = activeTab();
    const input = queryTabs.querySelector("input[data-query-tab-name]");
    if (!tab || !input) {
        return;
    }

    const fileName = `${tab.name}.sql`;
    if (input.value != fileName && document.activeElement != input) {
        input.value = fileName;
    }
    input.maxLength = MAX_QUERY_FILE_NAME_LENGTH;
    input.title = fileName;
    input.autocomplete = "off";
    input.spellcheck = false;

    // Let index.js persist migrated defaults through its existing rename handler.
    if (migrated) {
        input.value = fileName;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

function focusActiveNameInput() {
    const input = queryTabs.querySelector("input[data-query-tab-name]");
    if (!input) {
        return;
    }

    input.focus();
    const extensionIndex = input.value.toLowerCase().endsWith(".sql")
        ? input.value.length - 4
        : input.value.length;
    input.setSelectionRange(0, extensionIndex);
}

function base64UrlToBytes(value) {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function gunzip(bytes) {
    if (typeof DecompressionStream != "function") {
        return null;
    }
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function submissionTabSnapshot() {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw.startsWith(SUBMISSION_PREFIX)) {
        return null;
    }

    try {
        const encoded = raw.slice(SUBMISSION_PREFIX.length);
        const separator = encoded.indexOf(".");
        if (separator < 1) {
            return null;
        }
        const format = encoded.slice(0, separator);
        let bytes = base64UrlToBytes(encoded.slice(separator + 1));
        if (format == "g") {
            bytes = await gunzip(bytes);
            if (!bytes) {
                return null;
            }
        } else if (format != "j") {
            return null;
        }

        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (payload && payload.v === 1 && Array.isArray(payload.q) && payload.q.length) {
            const tabs = payload.q.map((item) => ({
                name: String(item?.[0] ?? ""),
                sql: String(item?.[1] ?? ""),
            }));
            const activeIndex = Number.isInteger(payload.a) ? payload.a : 0;
            return { tabs, activeIndex };
        }

        // Compatibility with links created by the first submission implementation.
        if (payload && payload.v === 1 && Array.isArray(payload.tabs) && payload.tabs.length) {
            const tabs = payload.tabs.map((tab) => ({
                name: String(tab?.name ?? ""),
                sql: String(tab?.sql ?? ""),
                id: String(tab?.id ?? ""),
            }));
            let activeIndex = tabs.findIndex((tab) => tab.id == payload.active);
            if (activeIndex < 0) {
                activeIndex = 0;
            }
            return { tabs, activeIndex };
        }
    } catch (error) {
        console.warn("Could not reconcile submission query tabs", error);
    }
    return null;
}

async function reconcileSubmissionTabs() {
    const snapshot = await submissionTabSnapshot();
    if (!snapshot || !queryTabs) {
        return;
    }

    let done = false;
    const apply = () => {
        if (done) {
            return true;
        }
        const app = window.app;
        const state = appState();
        if (
            !app ||
            !app.ui ||
            !app.ui.editor ||
            !state ||
            state.queryTabs.length != snapshot.tabs.length ||
            !state.queryTabs.length
        ) {
            return false;
        }

        // Restore every tab by position. This is deliberately independent of
        // which tab happened to be active while index.js initialized the page.
        for (let i = 0; i < snapshot.tabs.length; i += 1) {
            state.queryTabs[i].name = snapshot.tabs[i].name;
            state.queryTabs[i].sql = snapshot.tabs[i].sql;
        }

        const activeIndex = Math.max(
            0,
            Math.min(snapshot.activeIndex, state.queryTabs.length - 1)
        );
        const active = state.queryTabs[activeIndex];
        state.activeQueryTabId = active.id;
        app.ui.editor.value = active.sql;

        // Let index.js perform its normal tab render, but set the state/editor
        // first so activateQueryTab cannot overwrite another tab during restore.
        const target = app.ui.queryTabs.querySelector(
            `[data-query-tab-id="${CSS.escape(active.id)}"]`
        );
        done = true;
        if (target) {
            target.click();
        }
        return true;
    };

    if (apply()) {
        return;
    }

    const observer = new MutationObserver(() => {
        if (apply()) {
            observer.disconnect();
        }
    });
    observer.observe(queryTabs, { childList: true, subtree: true });

    // Avoid keeping the observer forever for a malformed/failed submission.
    setTimeout(() => observer.disconnect(), 10000);
}

function normalizeSuccessCheckmark() {
    const Status = customElements.get("sqlime-status");
    if (!Status || Status.prototype.__normalizesLeadingCheckmark) {
        return;
    }
    const originalSuccess = Status.prototype.success;
    Status.prototype.success = function (message) {
        if (typeof message == "string") {
            message = message.replace(/^\s*✓\s*/, "");
        }
        return originalSuccess.call(this, message);
    };
    Status.prototype.__normalizesLeadingCheckmark = true;
}

if (queryTabs) {
    const observer = new MutationObserver(() => {
        configureActiveNameInput();
    });
    observer.observe(queryTabs, { childList: true, subtree: true });

    queryTabs.addEventListener("click", (event) => {
        const clickedTab = event.target.closest("[data-query-tab-id]");
        if (!clickedTab) {
            return;
        }
        queueMicrotask(() => {
            configureActiveNameInput();
            focusActiveNameInput();
        });
    });

    queryTabs.addEventListener("keydown", (event) => {
        const input = event.target.closest("input[data-query-tab-name]");
        if (!input) {
            return;
        }

        if (event.key == "Enter") {
            event.preventDefault();
            input.blur();
        } else if (event.key == "Escape") {
            event.preventDefault();
            const tab = activeTab();
            if (tab) {
                input.value = `${tab.name}.sql`;
            }
            input.blur();
        }
    });

    queryTabs.addEventListener("change", (event) => {
        const input = event.target.closest("input[data-query-tab-name]");
        if (!input) {
            return;
        }
        queueMicrotask(() => configureActiveNameInput());
    });

    configureActiveNameInput();
}

// submission-links.js awaits before taking its snapshot. This capture listener
// therefore synchronizes the editor into app.state before that snapshot resumes.
document.addEventListener(
    "click",
    (event) => {
        if (event.target.closest("#submit-submission")) {
            syncActiveTabSql();
        }
    },
    true
);

normalizeSuccessCheckmark();
reconcileSubmissionTabs();
