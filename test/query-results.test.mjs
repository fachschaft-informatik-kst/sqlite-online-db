// Run with: node --test test/query-results.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../js/sqlite/sqlean.js');
const sqlite3 = await globalThis.sqlite3InitModule({
    wasmBinary: fs.readFileSync(new URL('../js/sqlite/sqlean.wasm', import.meta.url)),
});
// Load the browser module without changing the project's module configuration.
const source = fs.readFileSync(new URL('../js/sqlite/db.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export .*;\s*$/gm, '');
const SQLite = vm.runInNewContext(`${source}\nSQLite;`);
const plain = (value) => JSON.parse(JSON.stringify(value));

function withDatabase(run) {
    const native = new sqlite3.oo1.DB(':memory:');
    const database = new SQLite('test.db', null, sqlite3.capi, native);
    try { run(database); } finally { native.close(); }
}

test('cross product preserves both article numbers and all four combinations', () => {
    withDatabase((db) => {
        db.execute(`CREATE TABLE artikel (artikelnr INTEGER PRIMARY KEY, beschreibung TEXT);
            CREATE TABLE tagespreis (artikelnr INTEGER PRIMARY KEY, tagespreis REAL);
            INSERT INTO artikel VALUES (1, 'Buch'), (2, 'Stift');
            INSERT INTO tagespreis VALUES (10, 4.5), (20, 7.5);`);
        const result = plain(db.execute('SELECT * FROM artikel, tagespreis ORDER BY artikel.artikelnr, tagespreis.artikelnr'));
        assert.deepEqual(result, {
            columns: ['artikelnr', 'beschreibung', 'artikelnr', 'tagespreis'],
            values: [[1, 'Buch', 10, 4.5], [1, 'Buch', 20, 7.5],
                [2, 'Stift', 10, 4.5], [2, 'Stift', 20, 7.5]],
        });
    });
});

test('duplicate aliases and numeric labels retain SQL order and null values', () => {
    withDatabase((db) => {
        assert.deepEqual(plain(db.execute('SELECT 42 AS "2", NULL AS "1", 7 AS "2"')), {
            columns: ['2', '1', '2'], values: [[42, null, 7]],
        });
    });
});

test('ordinary queries, empty results and mutation counts remain supported', () => {
    withDatabase((db) => {
        assert.deepEqual(plain(db.execute("SELECT 'hello' AS message")), {
            columns: ['message'], values: [['hello']],
        });
        assert.equal(db.execute('SELECT 1 WHERE 0'), null);
        assert.equal(db.execute(''), null);
        db.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');
        const result = plain(db.execute("INSERT INTO items VALUES (1, 'one')"));
        assert.deepEqual(result, {
            columns: ['changes'], values: [[1]], meta: { changes: 1, action: 'insert' },
        });
        assert.equal(db.getTableInfo('items').values[0][3], 'id');
    });
});
