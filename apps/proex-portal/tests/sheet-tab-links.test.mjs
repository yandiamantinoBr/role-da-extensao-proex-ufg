import assert from 'node:assert/strict';
import test from 'node:test';
import { sheetTabGid } from '../lib/sync/sheet-tab-catalog.ts';

test('copied links configure only tabs of the connected Google workbook', () => {
  const id = 'synthetic-connected-workbook';
  const link = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  assert.equal(sheetTabGid(`${link}?gid=0#gid=0`, id), 0);
  assert.equal(sheetTabGid(`${link}#gid=2147483647`, id), 2147483647);
  assert.equal(sheetTabGid(link.replace('/d/', '/u/1/d/') + '#gid=12', id), 12);
  for (const bad of [link, `${link}?gid=1#gid=2`, `${link}#gid=-1`, `${link}#gid=2147483648`,
    `${link.replace(id, 'synthetic-another-workbook')}#gid=1`, `${link.replace('docs.google.com', 'docs.google.com.example.invalid')}#gid=1`]) {
    assert.equal(sheetTabGid(bad, id), null, bad);
  }
});
