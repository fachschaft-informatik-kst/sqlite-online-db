const URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.6-luna";
const PROMPT = "You are an SQLite AI assistant. Be brief and direct in your response.";

const PARAMS = {
    max_output_tokens: 1000,
};

// OpenAI represents the OpenAI Responses API.
class OpenAI {
    constructor(apiKey, prompt = "") {
        this.apiKey = apiKey;
        this.prompt = prompt || PROMPT;
        this.headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        };
    }

    // ask queries the API and returns the resulting text.
    async ask(question) {
        const params = this.prepareParams(question);
        const resp = await this.fetchResponse(params);
        const answer = extractOutputText(resp);
        if (!answer) {
            throw new Error("OpenAI returned an empty answer.");
        }
        return answer;
    }

    prepareParams(question) {
        return Object.assign(
            {
                model: MODEL,
                instructions: this.prompt,
                input: question,
            },
            PARAMS
        );
    }

    async fetchResponse(params) {
        const response = await fetch(URL, {
            method: "post",
            headers: this.headers,
            body: JSON.stringify(params),
        });

        let data;
        try {
            data = await response.json();
        } catch (error) {
            throw new Error(`OpenAI request failed (${response.status}).`);
        }

        if (!response.ok) {
            const message =
                data && data.error && data.error.message
                    ? data.error.message
                    : `OpenAI request failed (${response.status}).`;
            throw new Error(message);
        }

        return data;
    }
}

function extractOutputText(response) {
    if (!response || !Array.isArray(response.output)) {
        return "";
    }

    const parts = [];
    for (const item of response.output) {
        if (!item || !Array.isArray(item.content)) {
            continue;
        }
        for (const content of item.content) {
            if (content && content.type == "output_text" && typeof content.text == "string") {
                parts.push(content.text);
            }
        }
    }

    return parts.join("\n").trim();
}

export { OpenAI };
