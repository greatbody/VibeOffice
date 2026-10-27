// Exporting a view of a workbook must not mark the workbook (or its recovery draft) as saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ensureChromium } from '../lib/input.mjs';
import { ensureServer, openPage } from '../../tools/ooxml/cdp.mjs';

// Other browser tests run concurrently; this file must not stop their server.
if (!process.env.BASE) {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  process.env.BASE = 'http://127.0.0.1:' + port;
}

test('CSV, text and HTML exports keep unsaved workbooks and their recovery identity', async () => {
  await ensureChromium();
  const stop = await ensureServer();
  const page = await openPage('ledger', { persistence: false, automated: true });
  try {
    const results = await page.evaluate(`(async () => {
      const b = L.app.books[L.app.cur], w = b.wb;
      L.ops.tx(w, 'Typing', () => L.ops.enter(w.sheets[0], 0, 0, '=1+2'));
      if (w.sheets.length < 2) w.addSheet('Other');
      w.sheets[1].cell(0, 0).v = 'Not in a CSV';
      let saved = 0, closePrompts = 0;
      VO.saved = () => { saved++; };
      L.saveFile = async () => 'saved';
      L.ui.msg = async (text) => {
        if (text.includes('save the changes')) { closePrompts++; return 2; }
        return 0;
      };
      const results = [];
      for (const type of ['csv', 'txt', 'html']) {
        b.dirty = true;
        const ok = await L.app.saveAs(type, 'Export.' + type);
        const dirty = b.dirty;
        const closed = await L.app.closeWorkbook();
        results.push({ type, ok, dirty, closed, retained: L.app.books.includes(b), saved, closePrompts });
      }
      return results;
    })()`);
    for (const [i, r] of results.entries()) assert.deepEqual(r, {
      type: ['csv', 'txt', 'html'][i], ok: true, dirty: true, closed: false, retained: true, saved: 0, closePrompts: i + 1,
    });
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); stop(); }
});

test('Save when closing stays open after an export; a full workbook save can close', async () => {
  await ensureChromium();
  const stop = await ensureServer();
  const page = await openPage('ledger', { persistence: false, automated: true });
  try {
    const result = await page.evaluate(`(async () => {
      const b = L.app.books[L.app.cur];
      L.ops.tx(b.wb, 'Typing', () => L.ops.enter(b.wb.sheets[0], 0, 0, '=1+2'));
      L.ui.msg = async () => 0; // Yes to saving, OK to the single-sheet export
      L.saveFile = async () => 'saved';
      L.dlg.saveAs = () => L.app.saveAs('csv', 'Export.csv');
      const exported = await L.app.closeWorkbook();
      const retained = L.app.books.includes(b);
      // Also check a cancelled download, then an ordinary full save.
      L.saveFile = async () => 'cancelled';
      const cancelled = await L.app.saveAs('xlsx', 'Book.xlsx');
      const stillDirty = b.dirty;
      L.saveFile = async () => 'saved';
      L.dlg.saveAs = () => L.app.saveAs('xlsx', 'Book.xlsx');
      const closed = await L.app.closeWorkbook();
      return { exported, retained, cancelled, stillDirty, closed, originalOpen: L.app.books.includes(b) };
    })()`);
    assert.deepEqual(result, { exported: false, retained: true, cancelled: false, stillDirty: true, closed: true, originalOpen: false });
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); stop(); }
});

test('desktop text saves still clear saved changes, but exports and edits during a save do not', async () => {
  await ensureChromium();
  const stop = await ensureServer();
  const page = await openPage('ledger', { persistence: false, automated: true });
  try {
    const result = await page.evaluate(`(async () => {
      const b = L.app.books[L.app.cur];
      b.wb.sheets.splice(1);
      b.wb.sheets[0].cell(0, 0).v = 3;
      b.untitled = false; b.name = 'Data.csv'; b.type = 'csv'; b.dirty = true;
      L.file.native = () => true;
      L.file.write = async () => ({ result: 'saved', bound: true });
      let saved = 0;
      VO.saved = () => { saved++; };
      await L.app.saveAs('csv', b.name, 'save');
      const inPlace = { dirty: b.dirty, saved };
      b.dirty = true;
      L.file.write = async () => ({ result: 'saved', bound: false });
      await L.app.saveAs('csv', 'Copy.csv', 'chosen');
      const exported = { dirty: b.dirty, saved };
      L.file.write = async () => { VO.changed(b); return { result: 'saved', bound: true }; };
      await L.app.saveAs('xlsx', 'Book.xlsx', 'chosen');
      return { inPlace, exported, concurrent: { dirty: b.dirty, saved } };
    })()`);
    assert.deepEqual(result, { inPlace: { dirty: false, saved: 1 }, exported: { dirty: true, saved: 1 }, concurrent: { dirty: true, saved: 2 } });
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); stop(); }
});
