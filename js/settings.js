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
    localStorage.setItem("github.username", ui.github.username.value);
    setSensitiveItem("github.token", ui.github.token.value);
});

ui.github.username.addEventListener("change", (event) => {
    localStorage.setItem("github.username", event.target.value);
});

ui.github.token.addEventListener("change", (event) => {
    setSensitiveItem("github.token", event.target.value);
});

ui.github.username.value = localStorage.getItem("github.username") || "";
ui.github.token.value = getSensitiveItem("github.token");
ui.openai.apikey.value = "";
localStorage.removeItem("openai.apikey");
sessionStorage.removeItem("openai.apikey");

function setSensitiveItem(key, value) {
    if (value) {
        sessionStorage.setItem(key, value);
    } else {
        sessionStorage.removeItem(key);
    }
    localStorage.removeItem(key);
}

function getSensitiveItem(key) {
    const sessionValue = sessionStorage.getItem(key);
    if (sessionValue) {
        return sessionValue;
    }
    const legacyValue = localStorage.getItem(key) || "";
    if (legacyValue) {
        sessionStorage.setItem(key, legacyValue);
        localStorage.removeItem(key);
    }
    return legacyValue;
}
