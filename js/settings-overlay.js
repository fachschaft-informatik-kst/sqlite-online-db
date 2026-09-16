// Display Settings in the existing page so navigating back never rebuilds SQLite.
// The same-origin iframe reuses the existing settings form and its save behavior.
let overlay = null;
let frame = null;
let previousFocus = null;
let previousOverflow = "";

function closeSettings() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.body.style.overflow = previousOverflow;
    window.app?.gister?.reload?.();
    previousFocus?.focus?.();
}

function setupFrame() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    const back = doc.querySelector('a[href="javascript:history.go(-1)"]');
    back?.addEventListener("click", (event) => {
        event.preventDefault();
        closeSettings();
    }, true);
    doc.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeSettings();
        }
    }, true);
}

function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "sqlime-settings-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Settings");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "10000", background: "rgba(0,0,0,.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "12px",
    });
    // The HTML hidden attribute must take precedence over the inline flex display.
    overlay.style.display = "none";
    const panel = document.createElement("section");
    Object.assign(panel.style, {
        width: "min(850px, 100%)", height: "min(850px, 94vh)", position: "relative",
        background: "white", borderRadius: "12px", overflow: "hidden", boxShadow: "0 18px 60px #0008",
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close settings and return to playground");
    Object.assign(close.style, {
        position: "absolute", top: "8px", right: "10px", zIndex: "1", cursor: "pointer",
        fontSize: "19px", border: "1px solid #888", background: "white", borderRadius: "6px",
        padding: "5px 10px",
    });
    close.addEventListener("click", closeSettings);
    frame = document.createElement("iframe");
    frame.title = "Playground settings";
    frame.src = new URL("../settings.html", import.meta.url).href;
    frame.style.cssText = "border:0;width:100%;height:100%;background:white";
    frame.addEventListener("load", setupFrame);
    panel.append(frame, close);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeSettings();
    });
    document.body.appendChild(overlay);
}

function openSettings() {
    ensureOverlay();
    previousFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.hidden = false;
    overlay.style.display = "flex";
    overlay.querySelector("button")?.focus();
    return Promise.resolve();
}

// Public API also used by Settings links inside SQLime's result view.
window.SqlimeSettingsOverlay = { open: openSettings, close: closeSettings };

document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.('a[href="settings.html"]');
    if (anchor) {
        event.preventDefault();
        openSettings();
    }
}, true);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && !overlay.hidden) {
        event.preventDefault();
        closeSettings();
        return;
    }
    // The keyboard shortcut otherwise invokes the old save() -> full navigation.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" &&
        window.app && !window.app.gister.hasCredentials()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSettings();
    }
}, true);

function patchAppActions() {
    const app = window.app;
    if (!app?.actions || app.actions.__settingsOverlayPatched) return;
    const originalVisit = app.actions.visit;
    const originalSave = app.actions.save;
    app.actions.visit = (page) => page === "settings"
        ? openSettings() : originalVisit(page);
    app.actions.save = (...args) => {
        app.gister.reload();
        return app.gister.hasCredentials() ? originalSave(...args) : openSettings();
    };
    app.actions.__settingsOverlayPatched = true;
}

patchAppActions();
window.addEventListener("DOMContentLoaded", patchAppActions, { once: true });
