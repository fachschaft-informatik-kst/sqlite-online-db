// Stores various database information
// in browser storage.

const PREFIX = "sqlime";

// get loads SQL query from the local storage
function get(key) {
    return localStorage.getItem(`${PREFIX}.query.${key}`);
}

function getTabs(key) {
    try {
        const tabs = JSON.parse(localStorage.getItem(`${PREFIX}.tabs.${key}`));
        return Array.isArray(tabs) ? tabs : [];
    } catch {
        return [];
    }
}

// save saves SQL query to the local storage
function set(key, sql) {
    if (!sql) {
        remove(key);
    }
    localStorage.setItem(`${PREFIX}.query.${key}`, sql);
}

function setTabs(key, tabs) {
    localStorage.setItem(`${PREFIX}.tabs.${key}`, JSON.stringify(tabs));
}

// remove deletes SQL query from the local storage
function remove(key) {
    localStorage.removeItem(`${PREFIX}.query.${key}`);
    localStorage.removeItem(`${PREFIX}.tabs.${key}`);
}

const storage = { get, getTabs, set, setTabs, remove };
export default storage;
