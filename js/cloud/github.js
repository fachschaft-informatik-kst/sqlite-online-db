// Github Gist API client.

import http from "./http.js";

const ID_PREFIX = "gist";

const HEADERS = {
    Accept: "application/json",
    "Content-Type": "application/json",
};

class Github {
    constructor() {
        this.name = "GitHub";
        this.prefix = ID_PREFIX;
        this.url = "https://api.github.com/gists";
        this.headers = Object.assign({}, HEADERS);
    }

    // loadCredentials loads GitHub credentials from browser storage.
    // The token is sufficient for GitHub API authentication; username is
    // optional and is only used to decide whether an existing gist can be
    // updated in place.
    loadCredentials() {
        this.username = getStorageItem(localStorage, "github.username") || "";
        this.password =
            getStorageItem(sessionStorage, "github.token") ||
            getStorageItem(localStorage, "github.token") ||
            "";
        delete this.headers.Authorization;
        if (this.password) {
            this.headers.Authorization = `Bearer ${this.password}`;
        }
    }

    // hasCredentials returns true when a GitHub API token is available.
    hasCredentials() {
        return Boolean(this.password);
    }

    // getUrl returns a gist URL by its id. A pinned revision is deliberately
    // omitted here so the normal GitHub Gist page remains the human-facing link.
    getUrl(id) {
        const gistId = String(id || "").split("@")[0];
        return `https://gist.github.com/${gistId}`;
    }

    // get returns a gist by its id. When revision is provided, GitHub returns
    // exactly that immutable Gist revision.
    get(id, revision = "") {
        const suffix = revision ? `/${revision}` : "";
        const promise = fetch(`${this.url}/${id}${suffix}`, {
            method: "get",
            headers: this.headers,
        })
            .then((response) => http.toJson(response))
            .then(async (response) => {
                if (!response.files || !("query.sql" in response.files)) {
                    return null;
                }
                return await buildGist(response);
            });
        return promise;
    }

    // create creates a new gist.
    create(name, schema, query) {
        const data = buildData(name, schema, query);
        const promise = fetch(this.url, {
            method: "post",
            headers: this.headers,
            body: JSON.stringify(data),
        })
            .then((response) => http.toJson(response))
            .then(async (response) => {
                const gist = await buildGist(response);
                // Once a gist has been successfully created we know which
                // GitHub account owns the token for the rest of this session.
                if (!this.username && gist.owner) {
                    this.username = gist.owner;
                }
                return gist;
            });
        return promise;
    }

    // update updates an existing gist. Database objects may carry a pinned
    // revision in their id (id@sha); updates always target the base Gist id.
    update(id, name, schema, query) {
        const gistId = String(id || "").split("@")[0];
        const data = buildData(name, schema, query);
        const promise = fetch(`${this.url}/${gistId}`, {
            method: "post",
            headers: this.headers,
            body: JSON.stringify(data),
        })
            .then((response) => http.toJson(response))
            .then(async (response) => {
                const gist = await buildGist(response);
                if (!this.username && gist.owner) {
                    this.username = gist.owner;
                }
                return gist;
            });
        return promise;
    }
}

function getStorageItem(storage, key) {
    try {
        return storage.getItem(key);
    } catch (error) {
        return null;
    }
}

// buildData creates an object for the GitHub request.
function buildData(name, schema, query) {
    return {
        description: name,
        public: true,
        files: {
            "schema.sql": {
                content: schema || "--",
            },
            "query.sql": {
                content: query || "--",
            },
        },
    };
}

// fileContent returns complete file content.
// The Gist API may truncate large files in `content`.
async function fileContent(file) {
    if (!file) {
        return "";
    }
    if (typeof file.content === "string" && !file.truncated) {
        return file.content;
    }
    if (!file.raw_url) {
        return file.content || "";
    }
    const response = await fetch(file.raw_url, { method: "get" });
    if (!response.ok) {
        return file.content || "";
    }
    return await response.text();
}

// gistRevision extracts the immutable revision SHA returned by GitHub. The
// history entry is preferred; raw_url is a fallback for API responses where
// history is unexpectedly absent.
function gistRevision(response) {
    const historyRevision = response.history?.[0]?.version;
    if (historyRevision) {
        return historyRevision;
    }

    for (const file of Object.values(response.files || {})) {
        const rawUrl = file?.raw_url || "";
        const match = rawUrl.match(/\/raw\/([0-9a-f]{40})(?:\/|$)/i);
        if (match) {
            return match[1];
        }
    }
    return "";
}

// buildGist creates a gist from the GitHub response.
async function buildGist(response) {
    const schema = await fileContent(response.files["schema.sql"]);
    const query = await fileContent(response.files["query.sql"]);
    const gist = {
        id: response.id,
        revision: gistRevision(response),
        prefix: ID_PREFIX,
        name: response.description,
        owner: response.owner ? response.owner.login : "",
        schema: schema,
        query: query,
    };
    if (gist.schema == "--") {
        gist.schema = "";
    }
    if (gist.query == "--") {
        gist.query = "";
    }
    return gist;
}

const github = new Github();
export default github;
