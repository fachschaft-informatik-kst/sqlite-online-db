import { OpenAI } from "./cloud/openai.js?v=20260913-2";

function getSavedApiKey() {
    try {
        return (sessionStorage.getItem("openai.apikey") || "").trim();
    } catch (error) {
        return "";
    }
}

async function handleAskAi(event) {
    const button = event.target.closest("button[data-action='askAi']");
    if (!button) {
        return;
    }

    // Prevent the legacy askAi handler in index.js from running and prompting
    // for a key. The key is configured explicitly in Settings instead.
    event.preventDefault();
    event.stopImmediatePropagation();

    const key = getSavedApiKey();
    if (!key) {
        window.location.assign("settings.html");
        return;
    }

    const app = window.app;
    if (!app || !app.ui) {
        return;
    }

    const ui = app.ui;
    const ai = new OpenAI(key);
    const question = ui.editor.query;

    button.disabled = true;
    ui.status.loading("Waiting for AI response...");

    const startedAt = performance.now();
    try {
        const answer = await ai.ask(question);
        const elapsed = (performance.now() - startedAt) / 1000;
        ui.status.success(`AI response, took ${elapsed.toFixed(1)} sec:`);
        ui.result.printMarkdown(answer);
    } catch (err) {
        ui.status.error(err instanceof Error ? err.message : String(err));
        ui.result.clear();
    } finally {
        button.disabled = false;
    }
}

// Capture the click before ActionController's bubbling listener. This makes
// the Settings-based key flow authoritative even while the legacy function
// remains in index.js.
document.addEventListener("click", handleAskAi, true);
