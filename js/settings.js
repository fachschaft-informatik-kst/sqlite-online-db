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

function setSensitiveItem(key, value) {
    if (!value) {
        const sessionRemoved = removeStorageItem(sessionStorage, key);
        const legacyRemoved = removeStorageItem(localStorage, key);
        return sessionRemoved && legacyRemoved;
    }

    // Sensitive credentials intentionally live in sessionStorage only.
    // Verify the write so browsers with storage restrictions do not display
    // a misleading "Settings saved" message.
    if (!setStorageItem(sessionStorage, key, value)) {
        return false;
    }
    if (getStorageItem(sessionStorage, key) !== value) {
        return false;
    }
    removeStorageItem(localStorage, key);
    return true;
}

function getSensitiveItem(key) {
    const sessionValue = getStorageItem(sessionStorage, key);
    if (sessionValue) {
        return sessionValue;
    }
    const legacyValue = getStorageItem(localStorage, key) || "";
    if (legacyValue && setStorageItem(sessionStorage, key, legacyValue)) {
        removeStorageItem(localStorage, key);
    }
    return legacyValue;
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
