const ui = {
    settings: document.querySelector("#settings"),
    status: document.querySelector("#settings-status"),
    github: {
        username: document.querySelector("#github-username"),
        token: document.querySelector("#github-token"),
    },
    openai: {
        apikey: document.querySelector("#openai-apikey"),
    },
};

ui.settings.addEventListener("submit", (event) => {
    event.preventDefault();

    const username = ui.github.username.value.trim();
    const githubToken = ui.github.token.value.trim();
    const openaiKey = ui.openai.apikey.value.trim();

    const usernameSaved = setStorageItem(localStorage, "github.username", username);
    const githubSaved = setSensitiveItem("github.token", githubToken);
    const openaiSaved = setSensitiveItem("openai.apikey", openaiKey);

    if (!usernameSaved || !githubSaved || !openaiSaved) {
        ui.status.textContent = "Could not save settings. Browser storage may be blocked.";
        return;
    }

    ui.status.textContent = "Settings saved.";
});

function markUnsaved() {
    ui.status.textContent = "Unsaved changes";
}

ui.github.username.addEventListener("input", markUnsaved);
ui.github.token.addEventListener("input", markUnsaved);
ui.openai.apikey.addEventListener("input", markUnsaved);

ui.github.username.value = getStorageItem(localStorage, "github.username") || "";
ui.github.token.value = getSensitiveItem("github.token");
ui.openai.apikey.value = getSensitiveItem("openai.apikey");

// Store credentials in localStorage so they remain available when navigating
// between settings.html and the playground, and also across tabs. Firefox
// treats localStorage as temporary session data in Private Browsing, so it is
// removed when the private browsing session ends.
function setSensitiveItem(key, value) {
    if (!value) {
        const localRemoved = removeStorageItem(localStorage, key);
        const sessionRemoved = removeStorageItem(sessionStorage, key);
        return localRemoved && sessionRemoved;
    }

    if (!setStorageItem(localStorage, key, value)) {
        return false;
    }
    if (getStorageItem(localStorage, key) !== value) {
        return false;
    }

    // Remove the old sessionStorage copy to keep one authoritative location.
    removeStorageItem(sessionStorage, key);
    return true;
}

function getSensitiveItem(key) {
    const localValue = getStorageItem(localStorage, key);
    if (localValue) {
        return localValue;
    }

    // Migrate credentials saved by older versions of the app.
    const sessionValue = getStorageItem(sessionStorage, key) || "";
    if (sessionValue && setStorageItem(localStorage, key, sessionValue)) {
        removeStorageItem(sessionStorage, key);
    }
    return sessionValue;
}

function getStorageItem(storage, key) {
    try {
        return storage.getItem(key);
    } catch (error) {
        return null;
    }
}

function setStorageItem(storage, key, value) {
    try {
        storage.setItem(key, value);
        return storage.getItem(key) === value;
    } catch (error) {
        return false;
    }
}

function removeStorageItem(storage, key) {
    try {
        storage.removeItem(key);
        return storage.getItem(key) === null;
    } catch (error) {
        return false;
    }
}
