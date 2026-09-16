// Run against a local static server: TEST_BASE_URL=http://127.0.0.1:8765 node test/smoke.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8765';
const gistId = 'a'.repeat(32);
const revision = 'b'.repeat(40);
const gist = {
    id: gistId,
    description: 'smoke-gist.db',
    owner: { login: 'smoke-test' },
    history: [{ version: revision }],
    files: {
        'schema.sql': { content: "CREATE TABLE numbers (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO numbers VALUES (1, 'baseline');", truncated: false },
        'query.sql': { content: 'SELECT value FROM numbers;', truncated: false },
    },
};

async function ready(page) {
    await page.waitForFunction(() => window.app?.ui?.name?.classList.contains('ready') &&
        window.app?.state?.blockCount === 0, { timeout: 20000 });
}

async function runSql(page, sql) {
    await page.waitForTimeout(700); // The playground deliberately throttles repeated Run clicks.
    return page.evaluate(async (text) => {
        const editor = window.app.ui.editor;
        editor.value = text;
        await window.app.actions.executeCurrent();
        return window.app.ui.result.innerText;
    }, sql);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Settings must keep the live SQLite connection and editor mounted.
    await page.goto(`${base}/index.html#demo.db`);
    await ready(page);
    await runSql(page, 'CREATE TABLE smoke_settings(value INTEGER); INSERT INTO smoke_settings VALUES (42);');
    const editorBefore = await page.evaluate(() => window.app.ui.editor);
    await page.locator('#toolbar a[href="settings.html"]').click();
    await page.waitForFunction(() => {
        const dialog = document.querySelector('#sqlime-settings-overlay');
        return dialog && !dialog.hidden && dialog.style.display === 'flex';
    });
    assert.equal(new URL(page.url()).hash, '#demo.db', 'Settings must not navigate away');
    const settings = page.frameLocator('#sqlime-settings-overlay iframe');
    await settings.locator('#save-settings').waitFor();
    await settings.locator('a[href="javascript:history.go(-1)"]').click();
    await page.waitForFunction(() => {
        const dialog = document.querySelector('#sqlime-settings-overlay');
        return dialog?.hidden && dialog.style.display === 'none';
    });
    assert.equal(await page.evaluate((prior) => window.app.ui.editor === prior, editorBefore), false,
        'Playwright cannot pass a DOM reference across evaluate calls');
    assert.match(await runSql(page, 'SELECT value FROM smoke_settings'), /42/,
        'Settings round-trip must preserve in-memory changes');
    console.log('PASS: Settings opens/closes without database reload or data loss');

    // A Gist should load from IndexedDB after the first fetch; refresh must clear the cache.
    let gistFetches = 0;
    await context.route('https://api.github.com/gists/**', async (route) => {
        gistFetches += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gist) });
    });
    await page.goto(`${base}/index.html#gist:${gistId}`);
    await ready(page);
    assert.match(await runSql(page, 'SELECT value FROM numbers'), /baseline/);
    assert.equal(gistFetches, 1, 'Initial Gist fetch');
    await page.reload();
    await ready(page);
    assert.equal(gistFetches, 1, 'Gist reload should use IndexedDB cache');
    await runSql(page, 'CREATE TABLE local_only(value INTEGER); INSERT INTO local_only VALUES (7);');
    await page.waitForTimeout(400);
    await page.reload();
    await ready(page);
    assert.match(await runSql(page, 'SELECT value FROM local_only'), /7/,
        'Mutations should survive a normal reload');
    assert.equal(gistFetches, 1, 'Locally modified Gist should still use cache');
    console.log('PASS: Gist cache and database mutations');

    // Link contains query tabs but opens an immutable original Gist revision in a fresh context.
    await page.evaluate(() => {
        const editor = window.app.ui.editor.input;
        editor.value = 'SELECT value FROM numbers';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-query-tab-new]').click();
        editor.value = 'SELECT COUNT(*) FROM numbers';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#submit-submission').click();
    await page.waitForFunction(() => Boolean(window.app.lastSubmissionUrl));
    const link = await page.evaluate(() => window.app.lastSubmissionUrl);
    const privateContext = await browser.newContext();
    let submissionFetches = 0;
    await privateContext.route('https://api.github.com/gists/**', async (route) => {
        submissionFetches += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gist) });
    });
    const review = await privateContext.newPage();
    review.on('pageerror', (error) => errors.push(error.message));
    await review.goto(link);
    await ready(review);
    await review.waitForFunction(() => window.app.state.queryTabs.length === 2);
    assert.equal((await review.evaluate(() => window.app.state.queryTabs.map(t => t.sql)))[1],
        'SELECT COUNT(*) FROM numbers', 'Second SQL tab must survive submission');
    const localTable = await runSql(review, "SELECT name FROM sqlite_schema WHERE name = 'local_only'");
    assert.doesNotMatch(localTable, /local_only/,
        'Submission must not inherit the teacher’s locally mutated Gist');
    await review.reload();
    await ready(review);
    assert.equal(submissionFetches, 1, 'Pinned submission reload should use immutable cache');
    assert.equal((await review.evaluate(() => window.app.state.queryTabs)).length, 2,
        'Submission tabs should persist after reload');
    await privateContext.close();
    console.log('PASS: Private-context immutable submission and tabs');

    await Promise.all([page.waitForEvent('load'), page.locator('#reload-gist').click()]);
    await ready(page);
    assert.equal(gistFetches, 2, 'Explicit ↻ gist must fetch a fresh copy');
    const refreshed = await runSql(page, "SELECT name FROM sqlite_schema WHERE name = 'local_only'");
    assert.doesNotMatch(refreshed, /local_only/, 'Explicit refresh must discard local DB changes');
    assert.deepEqual(errors, [], 'No unhandled page errors');
    console.log('PASS: Explicit refresh and no unhandled browser errors');
    await context.close();
} finally {
    await browser.close();
}
