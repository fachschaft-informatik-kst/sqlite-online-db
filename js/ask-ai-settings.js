import { OpenAI } from "./cloud/openai.js";

function getSavedApiKey() {
    try {
        return (sessionStorage.getItem("openai.apikey") || "").trim();
    } catch (error) {
        return "";
    }
}

if (window.app && window.app.actions && window.app.ui) {
    window.app.actions.askAi = async function () {
        const key = getSavedApiKey();
        if (!key) {
            window.location.assign("settings.html");
            return Promise.resolve();
        }

        const ui = window.app.ui;
        const ai = new OpenAI(key);
        const question = ui.editor.query;
        ui.status.loading("Waiting for AI response (can take up to 30 seconds)");
        const startedAt = performance.now();

        try {
            const answer = await ai.ask(question);
            const elapsed = (performance.now() - startedAt) / 1000;
            ui.status.success(`AI response, took ${elapsed.toFixed(1)} sec:`);
            ui.result.printMarkdown(answer);
        } catch (err) {
            ui.status.error(err);
            ui.result.clear();
        }

        return Promise.resolve();
    };
}
