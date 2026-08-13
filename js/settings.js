const ui = {
    settings: document.querySelector("#settings"),
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
    setStorageItem(localStorage, "github.username", ui.github.username.value);
    setSensitiveItem("github.token", ui.github.token.value);
});

ui.github.username.addEventListener("change", (event) => {
    setStorageItem(localStorage, "github.username", event.target.value);
});

ui.github.token.addEventListener("change", (event) => {
    setSensitiveItem("github.token", event.target.value);
});

ui.github.username.value = getStorageItem(localStorage, "github.username") || "";
ui.github.token.value = getSensitiveItem("github.token");
ui.openai.apikey.value = "";
localStorage.removeItem("openai.apikey");
sessionStorage.removeItem("openai.apikey");

function setSensitiveItem(key, value) {
    if (value) {
        setStorageItem(sessionStorage, key, value);
    } else {
        removeStorageItem(sessionStorage, key);
    }
    removeStorageItem(localStorage, key);
}

function getSensitiveItem(key) {
    const sessionValue = getStorageItem(sessionStorage, key);
    if (sessionValue) {
        return sessionValue;
    }
    const legacyValue = getStorageItem(localStorage, key) || "";
    if (legacyValue) {
        setStorageItem(sessionStorage, key, legacyValue);
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
    } catch (error) {
    }
}

function removeStorageItem(storage, key) {
    try {
        storage.removeItem(key);
    } catch (error) {
    }
}
