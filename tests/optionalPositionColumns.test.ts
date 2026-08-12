import assert from "node:assert/strict";
import test from "node:test";
import {
  POSITION_COLUMN_LAYOUT,
  POSITION_COLUMN_WIDTHS,
  POSITION_TABLE_BOUNDS,
} from "../src/app/api/plannings/[planningId]/offer/pdf/detail-pages";

test("standard and optional position rows share one immutable column geometry", () => {
  assert.equal(POSITION_COLUMN_WIDTHS.pos, 40);
  assert.equal(POSITION_COLUMN_WIDTHS.qtyW, 55);
  assert.equal(POSITION_COLUMN_WIDTHS.priceW, 95);
  assert.equal(POSITION_COLUMN_WIDTHS.totalW, 100);

  assert.equal(POSITION_COLUMN_LAYOUT.posX, POSITION_TABLE_BOUNDS.left + 6);
  assert.equal(POSITION_COLUMN_LAYOUT.descX, POSITION_TABLE_BOUNDS.left + 40);
  assert.equal(POSITION_COLUMN_LAYOUT.qtyRight, POSITION_COLUMN_LAYOUT.priceLeft - 12);
  assert.equal(POSITION_COLUMN_LAYOUT.priceRight, POSITION_COLUMN_LAYOUT.totalLeft - 12);
  assert.equal(POSITION_COLUMN_LAYOUT.totalRight, POSITION_TABLE_BOUNDS.right);

  assert.equal(Object.isFrozen(POSITION_COLUMN_LAYOUT), true);
});
