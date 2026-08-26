import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { usePlannerV2Store } from "../../src/components_v2/state/plannerV2Store";
import { overlapsReservedRect } from "../../src/components_v2/zones/utils";

const ROOF_ID = "roof-reserved-collision";

beforeEach(() => {
  usePlannerV2Store.setState({
    zones: [
      {
        id: "reserved-square",
        roofId: ROOF_ID,
        type: "riservata",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    ],
  });
});

afterEach(() => {
  usePlannerV2Store.setState({ zones: [], selectedZoneId: undefined });
});

test("reserved collision legacy: a completely external module does not collide", () => {
  assert.equal(
    overlapsReservedRect({ cx: 20, cy: 20, w: 4, h: 4, angleDeg: 0 }, ROOF_ID),
    false,
  );
});

test("reserved collision legacy: an external center still collides when a corner overlaps", () => {
  assert.equal(
    overlapsReservedRect({ cx: 15, cy: 15, w: 12, h: 12, angleDeg: 0 }, ROOF_ID),
    true,
  );
});

test("reserved collision legacy: simple edge contact counts as collision", () => {
  assert.equal(
    overlapsReservedRect({ cx: 15, cy: 5, w: 10, h: 6, angleDeg: 0 }, ROOF_ID),
    true,
  );
});

test("reserved collision legacy: a module fully inside the reserved zone collides", () => {
  assert.equal(
    overlapsReservedRect({ cx: 5, cy: 5, w: 4, h: 4, angleDeg: 0 }, ROOF_ID),
    true,
  );
});
