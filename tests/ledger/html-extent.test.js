// HTML exports use the worksheet's full extent, not the Excel 97-2003 limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./load.js');

test('HTML export includes columns beyond IV, through the last Excel column', async () => {
  const wb = new L.model.Workbook(), sh = wb.addSheet('Wide');
  sh.cell(0, 0).v = 'First column';
  sh.cell(0, 255).v = 'Legacy boundary';
  sh.cell(0, 256).v = 'Column IW';
  sh.cell(0, L.model.MAXC - 1).v = 'Column XFD';
  const html = await L.csv.writeHTML(wb).text();
  for (const text of ['First column', 'Legacy boundary', 'Column IW', 'Column XFD']) assert.ok(html.includes('>' + text + '</td>'), text);
  assert.equal((html.match(/<col /g) || []).length, L.model.MAXC);
});

test('HTML export includes rows beyond 65536', async () => {
  const wb = new L.model.Workbook(), sh = wb.addSheet('Tall');
  sh.cell(0, 0).v = 'First row';
  sh.cell(65535, 0).v = 'Legacy boundary';
  sh.cell(65536, 0).v = 'Row 65537';
  const html = await L.csv.writeHTML(wb).text();
  for (const text of ['First row', 'Legacy boundary', 'Row 65537']) assert.ok(html.includes('>' + text + '</td>'), text);
  assert.equal((html.match(/<tr /g) || []).length, 65537);
});
