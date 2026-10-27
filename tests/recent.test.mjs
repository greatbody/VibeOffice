// Real IndexedDB transactions: preview updates must not overwrite drafts, saves or discards.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ensureChromium } from './lib/input.mjs';
import { ensureServer, openPage } from '../tools/ooxml/cdp.mjs';

// An origin of this run's own, or the older-code server supplied by tools/older.mjs.
if (!process.env.BASE) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  process.env.BASE = 'http://127.0.0.1:' + port;
}

for (const app of ['quire', 'ledger', 'lectern']) test(app + ': concurrent recent-file updates keep each other’s changes', async () => {
  await ensureChromium();
  const stop = await ensureServer();
  const page = await openPage(app, { persistence: false, automated: true });
  try {
    const r = await page.evaluate(`(async () => {
      const recent = VO.recent, app = ${JSON.stringify(app)}, name = 'atomic-' + crypto.randomUUID();
      const key = await recent.put(app, name, new Blob(['original']), false);
      const draft = () => recent.setDraft(key, app, name, name, new Blob(['edits']));
      const preview = () => recent.setThumb(key, new Blob(['preview']));
      const state = async () => {
        const e = await recent.get(key);
        return e ? { file: e.file && await e.file.text(), draft: e.draft && await e.draft.file.text(), thumb: e.thumb && await e.thumb.text() } : null;
      };
      try {
        await Promise.all([draft(), preview()]);
        const drafted = await state();
        await Promise.all([recent.put(app, name, new Blob(['saved']), false), preview()]);
        const saved = await state();
        await draft();
        await Promise.all([recent.discardDraft(key), preview()]);
        const discarded = await state();
        await Promise.all([draft(), recent.put(app, name, new Blob(['reopened']), true)]);
        const reopened = await state();
        await recent.remove(key);
        await preview();
        const removed = await state();
        // A never-saved draft is removed entirely, and a pending preview must not resurrect it.
        await draft();
        await Promise.all([recent.discardDraft(key), preview()]);
        const discardedNew = await state();
        return { drafted, saved, discarded, reopened, removed, discardedNew };
      } finally { await recent.remove(key); }
    })()`);
    assert.deepEqual(r, {
      drafted: { file: 'original', draft: 'edits', thumb: 'preview' },
      saved: { file: 'saved', draft: null, thumb: 'preview' },
      discarded: { file: 'saved', draft: null, thumb: 'preview' },
      reopened: { file: 'reopened', draft: 'edits', thumb: 'preview' },
      removed: null, discardedNew: null,
    });
    assert.deepEqual(page.errors, []);
    assert.deepEqual(page.requests, []);
  } finally { await page.close(); stop(); }
});
