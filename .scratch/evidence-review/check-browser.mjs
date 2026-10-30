import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { renderPanel } from '../../tests/integration/extracted-details.test.mjs';
const css = readdirSync('.next/static/chunks').filter(name => name.endsWith('.css')).map(name => readFileSync(`.next/static/chunks/${name}`, 'utf8')).join('\n');
const { html, text } = renderPanel();
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  const page = await browser.newPage();
  for (const width of [1440, 900, 375]) {
    await page.setViewportSize({width, height: 1000});
    await page.setContent(`<style>${css}</style><main class="mx-auto max-w-5xl p-5"><details open class="rounded-2xl border border-ui-border bg-surface p-5"><summary>Review extracted details</summary><div class="mt-5">${html}</div></details></main>`);
    const item = page.locator('details[data-extracted-fact]').first();
    const summary = item.locator('summary');
    const input = item.locator('input[name="editedValue"]');
    assert.equal(await input.isVisible(), false);
    const closed = await item.boundingBox();
    assert.ok(closed.height < (width >= 1280 ? 60 : 120), `compact item at ${width}: ${closed.height}px`);
    assert.equal(await item.evaluate(el => el.open), false);
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await item.evaluate(el => el.open), true);
    assert.equal(await input.isVisible(), true);
    assert.ok((await item.innerText()).includes(text.trim()));
    await input.fill('Unsaved reviewer correction');
    await summary.click();
    assert.equal(await input.isVisible(), false);
    await summary.click();
    assert.equal(await input.inputValue(), 'Unsaved reviewer correction');
    assert.equal(await page.locator('button[data-source-id="doc-2"]').isVisible(), true);
    assert.equal(await page.getByText('No source reference available').first().isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
    await page.screenshot({path: `.scratch/evidence-review/expanded-${width}.png`, fullPage: true});
    await summary.click();
    await page.screenshot({path: `.scratch/evidence-review/compact-${width}.png`, fullPage: true});
    console.log(`PASS ${width}px: compact height ${closed.height}px, keyboard disclosure, full long text, source references, retained draft, no overflow`);
  }
} finally { await browser.close(); }
