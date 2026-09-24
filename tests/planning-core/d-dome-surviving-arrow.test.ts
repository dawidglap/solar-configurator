import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveOutwardBlockArrowAzimuths,
  type BlockArrowMember,
} from "../../src/components_v2/modules/panels/moduleSlope";

const pair = (blockKey = "block-1"): BlockArrowMember[] => [
  {
    id: `${blockKey}:slot-0`,
    blockKey,
    slotIndex: 0,
    moduleFaceAzimuthDeg: 90,
    cx: 1,
    cy: 0,
  },
  {
    id: `${blockKey}:slot-1`,
    blockKey,
    slotIndex: 1,
    moduleFaceAzimuthDeg: 270,
    cx: -1,
    cy: 0,
  },
];

function arrowFor(members: readonly BlockArrowMember[], id: string): number | undefined {
  return resolveOutwardBlockArrowAzimuths(members).get(id);
}

test("deleting D-Dome slot 0 preserves slot 1 physical face and arrow", () => {
  const initial = pair();
  const survivor = initial[1];
  const before = arrowFor(initial, survivor.id);
  const after = arrowFor([survivor], survivor.id);

  assert.equal(before, 270);
  assert.equal(after, before);
  assert.equal(survivor.slotIndex, 1);
  assert.equal(survivor.moduleFaceAzimuthDeg, 270);
});

test("deleting D-Dome slot 1 preserves slot 0 physical face and arrow", () => {
  const initial = pair();
  const survivor = initial[0];
  const before = arrowFor(initial, survivor.id);
  const after = arrowFor([survivor], survivor.id);

  assert.equal(before, 90);
  assert.equal(after, before);
  assert.equal(survivor.slotIndex, 0);
  assert.equal(survivor.moduleFaceAzimuthDeg, 90);
});

test("a partial D-Dome block does not alter arrows in other blocks", () => {
  const first = pair("block-1");
  const second = pair("block-2").map((member) => ({
    ...member,
    cx: member.cx + 10,
  }));
  const initial = [...first, ...second];
  const before = resolveOutwardBlockArrowAzimuths(initial);
  const afterMembers = initial.filter((member) => member.id !== "block-1:slot-0");
  const after = resolveOutwardBlockArrowAzimuths(afterMembers);

  assert.equal(after.get("block-1:slot-1"), before.get("block-1:slot-1"));
  assert.equal(after.get("block-2:slot-0"), before.get("block-2:slot-0"));
  assert.equal(after.get("block-2:slot-1"), before.get("block-2:slot-1"));
});

test("rotated D-Dome survivor keeps its pre-delete arrow and rotates independently afterwards", () => {
  const rotatedPair = pair().map((member) => ({
    ...member,
    cx: -member.cy,
    cy: member.cx,
    moduleFaceAzimuthDeg: (member.moduleFaceAzimuthDeg! + 90) % 360,
  }));
  const survivor = rotatedPair[1];
  assert.equal(arrowFor(rotatedPair, survivor.id), 0);
  assert.equal(arrowFor([survivor], survivor.id), 0);

  const rotatedOrphan = {
    ...survivor,
    moduleFaceAzimuthDeg: (survivor.moduleFaceAzimuthDeg! + 90) % 360,
  };
  assert.equal(arrowFor([rotatedOrphan], rotatedOrphan.id), 90);
});

test("D-Dome orphan face identity survives save/reload and undo-style restoration", () => {
  const initial = pair();
  const initialArrows = resolveOutwardBlockArrowAzimuths(initial);
  const survivor = JSON.parse(JSON.stringify(initial[1])) as BlockArrowMember;
  assert.equal(arrowFor([survivor], survivor.id), initialArrows.get(survivor.id));

  const restored = JSON.parse(JSON.stringify(initial)) as BlockArrowMember[];
  assert.deepEqual(
    [...resolveOutwardBlockArrowAzimuths(restored)],
    [...initialArrows],
  );
});
