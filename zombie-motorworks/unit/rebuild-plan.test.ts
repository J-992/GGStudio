/**
 * Guards on "Rebuild Car" being a single press.
 *
 * The defect this file exists for: a wheel and the frame box it hangs off both
 * die in the same wave, the plan validates each missing part against the rig as
 * it stands, and the wheel is rejected because its mount is not back yet. The
 * player then has to press the button a second time. Plans are resolved in
 * passes so that cannot come back.
 */

import { describe, expect, it } from 'vitest';
import { planRebuild } from '../src/core/rebuild.ts';
import { createEmptyBlueprint } from '../src/core/blueprint.ts';
import { getPartDef } from '../src/core/parts.ts';
import { canPlacePart } from '../src/core/placement.ts';
import type { PlacedPart, VehicleBlueprint } from '../src/core/types.ts';

const core: PlacedPart = {
  id: 'p1',
  defId: 'chassis-core',
  pos: { x: 0, y: 1, z: 0 },
  orient: 0,
  config: {},
};

const frame: PlacedPart = {
  id: 'p2',
  defId: 'frame-box',
  pos: { x: 0, y: 1, z: -1 },
  orient: 0,
  config: {},
};

const wheel: PlacedPart = {
  id: 'p3',
  defId: 'wheel-standard',
  // Mounts through its +x socket, so the frame box at x = 0 is what holds it.
  pos: { x: -1, y: 1, z: -1 },
  orient: 0,
  config: { driven: true },
};

function rig(parts: PlacedPart[]): VehicleBlueprint {
  return { ...createEmptyBlueprint('stub'), parts };
}

describe('planRebuild', () => {
  it('restores a chain of missing parts in one plan', () => {
    // Sanity: the wheel on its own really is unplaceable, which is the whole
    // reason a single-pass plan needed two presses.
    const stump = rig([core]);
    expect(
      canPlacePart(stump, getPartDef, wheel.defId, wheel.pos, wheel.orient)
        .ok,
    ).toBe(false);

    const plan = planRebuild(stump, getPartDef, [wheel, frame]);
    expect(plan.parts.map((part) => part.id)).toEqual(['p2', 'p3']);
    expect(plan.totalCost).toBe(
      getPartDef('frame-box').cost + getPartDef('wheel-standard').cost,
    );
  });

  it('hands back parts in an order each one is valid in', () => {
    let draft = rig([core]);
    const plan = planRebuild(draft, getPartDef, [wheel, frame]);
    for (const part of plan.parts) {
      const check = canPlacePart(
        draft,
        getPartDef,
        part.defId,
        part.pos,
        part.orient,
        part.config,
      );
      expect(check.ok).toBe(true);
      draft = { ...draft, parts: [...draft.parts, part] };
    }
  });

  it('leaves out a part whose old cell has been built over', () => {
    // Something else now sits where the frame used to be, so it cannot go back
    // and is charged for neither in the cost nor in the action.
    const occupied = rig([core, { ...frame, id: 'p9' }]);
    const plan = planRebuild(occupied, getPartDef, [frame]);
    expect(plan.parts).toEqual([]);
    expect(plan.totalCost).toBe(0);
  });

  it('is a no-op when nothing is missing', () => {
    expect(planRebuild(rig([core]), getPartDef, [])).toEqual({
      parts: [],
      totalCost: 0,
    });
  });

  it('does not mutate the blueprint it is planning against', () => {
    const stump = rig([core]);
    planRebuild(stump, getPartDef, [wheel, frame]);
    expect(stump.parts).toHaveLength(1);
  });
});
