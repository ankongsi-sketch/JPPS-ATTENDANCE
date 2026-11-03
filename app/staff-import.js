'use strict';
// Reads a PERJAWATAN staff list (.xlsx) into [{ name, grade, scheme, locationCode }].
// It looks for the sheet whose header row has "PENYANDANG JAWATAN" and "GRED",
// carries the scheme and grade down through merged/blank cells, and skips
// vacant posts ("Kosong") and total rows.
const ExcelJS = require('exceljs');

const text = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('result' in v) return text(v.result);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
};
const clean = s => text(s).replace(/\s+/g, ' ').trim();
const norm = s => clean(s).toUpperCase();

async function parseStaffWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  for (const ws of wb.worksheets) {
    let cols = null;
    const staff = [];
    let scheme = '', grade = '';
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c] = norm(cell.value); });
      const nameCol = vals.findIndex(v => v && v.startsWith('PENYANDANG'));
      const gradeCol = vals.findIndex(v => v === 'GRED');
      if (nameCol > 0 && gradeCol > 0 && vals.includes('BIL')) {
        cols = {
          bil: vals.findIndex(v => v === 'BIL'),
          scheme: vals.findIndex(v => v && v.startsWith('SKIM')),
          grade: gradeCol, name: nameCol,
          loc: vals.findIndex(v => v === 'LOKASI'),
        };
        return;
      }
      if (!cols) return;
      const cell = c => (c > 0 ? row.getCell(c).value : null);
      const bil = text(cell(cols.bil)).trim();
      if (!/^\d+$/.test(bil)) return; // headers, group titles, totals
      if (clean(cell(cols.scheme))) scheme = clean(cell(cols.scheme));
      if (clean(cell(cols.grade))) grade = clean(cell(cols.grade)).replace(/\s*\/\s*/g, '/').toUpperCase();
      const name = clean(cell(cols.name));
      if (!name || /^kosong$/i.test(name) || /dimansuhkan/i.test(name)) return;
      staff.push({ name, grade, scheme, locationCode: norm(cell(cols.loc)) });
    });
    if (cols && staff.length) return staff;
  }
  throw new Error('No staff list found. The sheet needs a header row with "GRED" and "PENYANDANG JAWATAN" columns.');
}

module.exports = { parseStaffWorkbook };
