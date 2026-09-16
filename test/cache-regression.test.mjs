import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const source = (path) => fs.readFileSync(new URL(path, ROOT), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cacheHarness() {
    const stores = new Map();
    let version = 0;
    let networkLoads = 0;
    let writes = 0;
    let reloads = 0;
    const events = new Map();
    let button;
    const commandbar = {
        querySelector() { return button || null; },
        appendChild(element) { button = element; },
    };
    const indexedDB = {
        open(name, requestedVersion) {
            const request = {};
            queueMicrotask(() => {
                const db = {
                    objectStoreNames: { contains: (store) => stores.has(store) },
                    createObjectStore(store) { stores.set(store, new Map()); },
                    close() {},
                    transaction(store) {
                        if (!stores.has(store)) throw new Error(`Missing store ${store}`);
                        const tx = {
                            objectStore() {
                                return {
                                    get(key) {
                                        const req = {};
                                        queueMicrotask(() => {
                                            req.result = stores.get(store).get(key);
                                            req.onsuccess?.();
                                            queueMicrotask(() => tx.oncomplete?.());
                                        });
                                        return req;
                                    },
                                    put(value) {
                                        writes++;
                                        stores.get(store).set(value.key, value);
                                        queueMicrotask(() => tx.oncomplete?.());
                                    },
                                    delete(key) {
                                        stores.get(store).delete(key);
                                        queueMicrotask(() => tx.oncomplete?.());
                                    },
                                };
                            },
                        };
                        return tx;
                    },
                };
                request.result = db;
                if (requestedVersion > version) {
                    version = requestedVersion;
                    request.onupgradeneeded?.();
                }
                request.onsuccess?.();
            });
            return request;
        },
    };

    class FakeDatabase {
        constructor(path, value = 'original') {
            this.path = path;
            this.value = value;
            this.name = 'library.db';
            this.id = 'abcdef';
            this.gistId = 'abcdef';
            this.owner = 'owner';
            this.hashcode = 123;
            this.query = '';
            this.db = { pointer: 1 };
            this.capi = { sqlite3_js_db_export: () => new TextEncoder().encode(this.value) };
        }
        execute(sql) {
            this.query = sql;
            if (sql.includes('INSERT')) this.value += ':changed';
            if (sql.includes('FAIL')) {
                this.value += ':partially-applied';
                throw new Error('SQL failed');
            }
            return { values: [] };
        }
        gatherTables() { return ['items']; }
        ensureName() { return this.name; }
    }
    class DatabasePath {
        constructor(value, type) { this.value = value; this.type = type; }
    }
    const manager = {
        async init(_gister, _name, path) {
            if (path.type === 'binary') {
                return new FakeDatabase(path, new TextDecoder().decode(path.value));
            }
            if (path.type === 'sql') return new FakeDatabase(path, 'migrated');
            networkLoads++;
            return new FakeDatabase(path);
        },
        async save(_gister, db) { return db; },
    };
    const window = {
        indexedDB,
        location: { hash: '#gist:abcdef', reload() { reloads++; } },
        addEventListener(name, callback) { events.set(name, callback); },
    };
    const document = {
        visibilityState: 'visible',
        addEventListener(name, callback) { events.set(name, callback); },
        querySelector(selector) { return selector === '#commandbar' ? commandbar : null; },
        createElement() {
            return { style: {}, dataset: {}, hidden: false, addEventListener(name, fn) { this[name] = fn; } };
        },
    };
    const context = {
        manager, SQLite: FakeDatabase, DatabasePath, indexedDB, window, document,
        customElements: { whenDefined: () => Promise.resolve() },
        localStorage: { removeItem() {} },
        console, setTimeout, clearTimeout, queueMicrotask,
        ArrayBuffer, Uint8Array, TextEncoder, TextDecoder,
    };
    const code = source('js/gist-workspace-fast.js').replace(/^import .*;\s*$/gm, '');
    vm.runInNewContext(code, context, { filename: 'gist-workspace-fast.js' });
    return {
        manager, FakeDatabase, DatabasePath, window, events, stores,
        get button() { return button; },
        get networkLoads() { return networkLoads; },
        get writes() { return writes; },
        get reloads() { return reloads; },
    };
}

const path = (h, id = 'gist:abcdef') => new h.DatabasePath(id, 'id');

test('Gist binary cache restores edits; plain SELECT does not rewrite entire DB', async () => {
    const h = cacheHarness();
    const db = await h.manager.init({}, '', path(h));
    assert.equal(h.networkLoads, 1);
    const originalWrites = h.writes;
    db.execute('SELECT 1');
    await sleep(260);
    assert.equal(h.writes, originalWrites);
    db.execute('INSERT INTO items VALUES (1)');
    await sleep(260);
    const reopened = await h.manager.init({}, '', path(h));
    assert.equal(h.networkLoads, 1);
    assert.equal(reopened.value, 'original:changed');
});

test('Refresh cancels pending snapshots and cannot recreate discarded cache', async () => {
    const h = cacheHarness();
    const db = await h.manager.init({}, '', path(h));
    db.execute('INSERT INTO items VALUES (1)');
    await h.button.click({ preventDefault() {}, stopPropagation() {}, currentTarget: h.button });
    await sleep(260);
    assert.equal(h.reloads, 1);
    assert.equal(h.stores.get('gist-snapshots').has('gist:abcdef'), false);
});

test('A partially successful SQL batch is still cached after an error', async () => {
    const h = cacheHarness();
    const db = await h.manager.init({}, '', path(h));
    assert.throws(() => db.execute('INSERT THEN FAIL'));
    await sleep(260);
    const reopened = await h.manager.init({}, '', path(h));
    assert.match(reopened.value, /partially-applied/);
});

test('Submission snapshots do not reuse modified teacher workspaces', async () => {
    const h = cacheHarness();
    const db = await h.manager.init({}, '', path(h));
    db.execute('INSERT INTO items VALUES (1)');
    await sleep(260);
    h.window.location.hash = '#submission=example';
    const sha = 'a'.repeat(40);
    const pinned = await h.manager.init({}, '', path(h, `gist:abcdef@${sha}`));
    assert.equal(pinned.value, 'original');
    const restored = await h.manager.init({}, '', path(h, `gist:abcdef@${sha}`));
    assert.equal(restored.value, 'original');
    assert.equal(h.networkLoads, 2);
    await h.manager.init({}, '', path(h));
    assert.equal(h.networkLoads, 3, 'legacy unpinned submission fetches its base remotely');
});

test('Submission SQL does not overwrite ordinary workspace storage', () => {
    const calls = [];
    const storage = {
        set(...args) { calls.push(['set', ...args]); },
        setTabs(...args) { calls.push(['setTabs', ...args]); },
    };
    const window = { location: { hash: '#submission=abc' } };
    vm.runInNewContext(source('js/submission-storage-guard.js').replace(/^import .*;\s*$/gm, ''), { storage, window });
    storage.set('library.db', 'SELECT 1');
    storage.setTabs('library.db', []);
    assert.equal(calls.length, 0);
    window.location.hash = '#gist:abcdef';
    storage.set('library.db', 'SELECT 1');
    storage.setTabs('library.db', []);
    assert.equal(calls.length, 2);
});

test('Settings overlay closes without navigation or losing the current DB', async () => {
    const elements = [];
    const document = {
        activeElement: { focus() {} },
        body: { style: { overflow: '' }, appendChild(el) { elements.push(el); } },
        addEventListener() {},
        createElement(tag) {
            return {
                tag, style: {}, dataset: {}, hidden: false,
                setAttribute() {}, append(...children) { this.children = children; },
                appendChild(child) { this.children = [child]; },
                addEventListener() {}, querySelector() { return { focus() {} }; },
            };
        },
    };
    let reloads = 0;
    const database = { important: 'still mounted' };
    const window = {
        app: {
            database, actions: { visit: async () => {}, save: async () => {} },
            gister: { reload() { reloads++; }, hasCredentials() { return false; } },
        },
        addEventListener() {},
    };
    const code = source('js/settings-overlay.js').replaceAll('import.meta.url', '"https://example.test/js/settings-overlay.js"');
    vm.runInNewContext(code, { window, document, URL, console });
    await window.SqlimeSettingsOverlay.open();
    assert.equal(elements[0].hidden, false);
    assert.equal(elements[0].style.display, 'flex');
    window.SqlimeSettingsOverlay.close();
    assert.equal(elements[0].hidden, true);
    assert.equal(elements[0].style.display, 'none');
    assert.equal(window.app.database, database);
    assert.equal(reloads, 1);
});
