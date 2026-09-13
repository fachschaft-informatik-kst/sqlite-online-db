// Query tab name UX enhancements.
// Keeps the existing tab state/rendering in index.js and adds direct filename editing.

const MAX_QUERY_FILE_NAME_LENGTH = 36;
const DEFAULT_QUERY_NAME_PATTERN = /^Query\s+(\d+)$/;

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
