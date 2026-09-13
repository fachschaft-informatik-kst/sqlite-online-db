// Keeps GitHub sharing working even when a browser has cached an older
// GitHub provider module that still required both username and token.

function getStorageItem(storage, key) {
    try {
        return storage.getItem(key) || "";
    } catch (error) {
        return "";
    }
}

function getGithubToken() {
    return (
        getStorageItem(sessionStorage, "github.token") ||
        getStorageItem(localStorage, "github.token")
    ).trim();
}

function syncGithubCredentials() {
    const app = window.app;
    if (!app || !app.gister) {
        return false;
    }

    const token = getGithubToken();
    const gister = app.gister;
    let provider;

    try {
        provider = gister.provider;
    } catch (error) {
        return false;
    }

    // Keep the provider's request headers in sync with the value that is
    // actually stored in the browser.
    provider.password = token;
    if (provider.headers) {
        if (token) {
            provider.headers.Authorization = `Bearer ${token}`;
        } else {
            delete provider.headers.Authorization;
        }
    }

    // Token authentication is sufficient for the GitHub Gist API. Do not let
    // an older cached provider send the user back to Settings just because a
    // username was not supplied.
    gister.hasCredentials = function () {
        return Boolean(getGithubToken());
    };

    return Boolean(token);
}

// index.js is a deferred ES module. Running this module after it is enough in
// normal loading order, while the microtask covers slower custom-element init.
syncGithubCredentials();
queueMicrotask(syncGithubCredentials);

// Refresh immediately before a Share click as well. This runs in capture phase
// before ActionController handles the button.
document.addEventListener(
    "click",
    (event) => {
        if (event.target.closest("button[data-action='save']")) {
            syncGithubCredentials();
        }
    },
    true
);
