import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

import {
  CAT_CLIP_NAMES,
  FBX_CLIP_FILES,
  RETARGET,
  buildCatClips,
  buildFbxClipSet,
} from '../src/entities/CatAnimations';

/**
 * Assembling the cat's clip set from the character pack.
 *
 * The pack ships the rig and five animation takes as separate FBX files against
 * one shared skeleton, plus nothing at all for four of the seven states the
 * selector can ask for. Three things there are easy to get wrong and invisible
 * until someone watches the cat:
 *
 *   - the takes carry baked root travel. The cat's position is the physics
 *     capsule's and its jump arc is gravity's, so a translated hips track is
 *     applied *on top* of movement the game has already done and throws the
 *     model clear of its own collider.
 *   - the joint mapping for the four states that have to be retargeted. The
 *     skeleton's spine chain is `Hips -> Spine02 -> Spine01 -> Spine`, so
 *     `Spine02` is the *lowest* joint despite the numbering, and mapping
 *     `spine -> Spine` bends the cat at the shoulders.
 *   - the composition. Authored angles assume identity rest rotations, which
 *     this rig does not have, so they have to be applied as deltas on the bind
 *     pose rather than written absolutely.
 */

const RIG = new URL('../public/assets/cat/kittycat.fbx', import.meta.url);
const ANIM_DIR = new URL('../public/assets/cat/anim/', import.meta.url);

/**
 * Joint names in the shipped rig, read straight out of the binary FBX.
 *
 * A binary FBX stores a node's name as `<name>\0\x01<class>` - the separator is
 * literally those two bytes - so the joints can be listed without standing up
 * FBXLoader, which wants a browser. Crude, but it reads the real shipped file
 * rather than a description of it, which is the entire point of this check.
 */
function fbxNodeNames(url: URL): Set<string> {
  const buffer = readFileSync(url);
  const names = new Set<string>();

  for (let i = 1; i < buffer.length - 1; i++) {
    if (buffer[i] !== 0x00 || buffer[i + 1] !== 0x01) continue;

    // Walk back over the printable run that precedes the separator.
    let start = i;
    while (start > 0 && buffer[start - 1] >= 0x20 && buffer[start - 1] <= 0x7e) start--;
    if (start === i) continue;

    const kind = buffer.toString('latin1', i + 2, i + 10);
    if (!kind.startsWith('Model') && !kind.startsWith('LimbNode')) continue;

    names.add(buffer.toString('latin1', start, i));
  }

  return names;
}

/**
 * Joint names in a take, read straight out of the binary GLB's JSON chunk.
 *
 * The takes ship as GLB (converted from the original FBX exports for size),
 * so this is the GLB counterpart of `fbxNodeNames` above - same "read the real
 * shipped file, not a description of it" reasoning, just glTF's own trivial
 * chunk layout (a 12-byte header, then a length-prefixed JSON chunk) instead
 * of FBX's binary node tree.
 */
function glbNodeNames(url: URL): Set<string> {
  const buffer = readFileSync(url);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString('utf-8', 20, 20 + jsonLength));
  return new Set<string>((json.nodes ?? []).map((n: { name?: string }) => n.name).filter(Boolean));
}

/**
 * A stand-in rig carrying the pack's joint names and deliberately non-identity
 * rest rotations - which is the whole point, since a rig with identity rest
 * poses could not tell "composed onto the bind" from "written absolutely".
 */
function syntheticRig(): THREE.Object3D {
  const root = new THREE.Object3D();
  let seed = 1;

  for (const name of Object.values(RETARGET)) {
    const bone = new THREE.Bone();
    bone.name = name;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    bone.quaternion.setFromAxisAngle(
      new THREE.Vector3(1, 2, 3).normalize(),
      ((seed % 1000) / 1000) * 0.8,
    );
    root.add(bone);
  }

  return root;
}

/**
 * Minimal stand-ins for the takes the pack supplies, with root motion on them.
 *
 * Shaped the way FBXLoader hands them over: one clip per file, under whatever
 * the take's stack happened to be called, which is why the loader takes them
 * positionally rather than by name.
 */
function syntheticTakes(): Record<string, THREE.AnimationClip[]> {
  const takes: Record<string, THREE.AnimationClip[]> = {};

  for (const state of Object.keys(FBX_CLIP_FILES)) {
    takes[state] = [
      new THREE.AnimationClip('Scene', 0.6, [
        new THREE.QuaternionKeyframeTrack(
          'Hips.quaternion',
          [0, 0.6],
          [0, 0, 0, 1, 0, 0, 0, 1],
        ),
        // The thing that has to be stripped: the run-jump really does travel.
        new THREE.VectorKeyframeTrack('Hips.position', [0, 0.6], [0, 0, 0, 0, 0, 159]),
        new THREE.VectorKeyframeTrack('Hips.scale', [0, 0.6], [1, 1, 1, 1, 1, 1]),
      ]),
    ];
  }

  return takes;
}

describe('the shipped character pack', () => {
  it('names takes that are actually on disk', () => {
    if (!existsSync(RIG)) return; // assets not extracted in this checkout

    for (const file of Object.values(FBX_CLIP_FILES)) {
      const path = new URL(`${file}.glb`, ANIM_DIR);
      expect(existsSync(path), `${file}.glb is not in public/assets/cat/anim/`).toBe(true);
    }
  });

  it('animates the same skeleton the rig has', () => {
    if (!existsSync(RIG)) return;

    // This is what lets the takes bind by name with no retargeting at all. If a
    // take ever ships against a different skeleton it binds to nothing and the
    // cat plays a T-pose, silently.
    const rig = fbxNodeNames(RIG);
    expect(rig.size).toBeGreaterThan(10);

    for (const file of Object.values(FBX_CLIP_FILES)) {
      const path = new URL(`${file}.glb`, ANIM_DIR);
      if (!existsSync(path)) continue;

      for (const joint of glbNodeNames(path)) {
        // `char1`/`Armature` are a take's own wrapper root - an empty,
        // untracked node with no counterpart in the rig. `Cat_Animation_
        // Eating` ships one of its own, named `target_character` (carried
        // over from the same quirk in its original FBX export), but it
        // carries no animation either.
        if (joint === 'char1' || joint === 'Armature' || joint === 'target_character') continue;
        expect(rig.has(joint), `${file} animates "${joint}", which the rig lacks`).toBe(true);
      }
    }
  });

  it('has every joint the retarget map aims at', () => {
    if (!existsSync(RIG)) return;

    const joints = fbxNodeNames(RIG);
    for (const [authored, target] of Object.entries(RETARGET)) {
      expect(joints.has(target), `${authored} -> ${target}, which is not in the rig`).toBe(
        true,
      );
    }
  });
});

describe('retarget map', () => {
  it('maps the spine the right way up', () => {
    // Guards the specific trap: `Spine02` is the joint nearest the hips and
    // `Spine` is the chest, so these two must not be swapped.
    expect(RETARGET.spine).toBe('Spine02');
    expect(RETARGET.chest).toBe('Spine');
  });

  it('leaves the ears and tail unmapped', () => {
    // The imported rig has neither, and aiming a track at a joint that does not
    // exist is a silent no-op rather than an error.
    for (const absent of ['earL', 'earR', 'tailA', 'tailB', 'tailC', 'tailD'] as const) {
      expect(RETARGET[absent]).toBeUndefined();
    }
  });
});

describe('buildFbxClipSet', () => {
  it('produces every state the clip selector can ask for', () => {
    const clips = buildFbxClipSet(syntheticTakes(), syntheticRig());
    expect(clips).not.toBeNull();

    const names = clips!.map((clip) => clip.name).sort();
    expect(names).toEqual([...CAT_CLIP_NAMES].sort());
  });

  it('takes run, jump, slide and eat from the pack rather than authoring them', () => {
    // The character's own animation is the requirement, not an approximation of
    // it - so these four states must come from a take and nowhere else.
    expect(Object.keys(FBX_CLIP_FILES).sort()).toEqual(['eat', 'jump', 'run', 'slide']);
  });

  it('strips root motion from the imported takes', () => {
    // The cat's position is the physics capsule's. A take that also translates
    // the hips throws the model off its own collider and snaps it back.
    const clips = buildFbxClipSet(syntheticTakes(), syntheticRig())!;

    for (const state of Object.keys(FBX_CLIP_FILES)) {
      const clip = clips.find((c) => c.name === state)!;
      expect(clip.tracks.length).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        expect(track.name.endsWith('.quaternion'), `${state} kept ${track.name}`).toBe(true);
      }
    }
  });

  it('rewrites the retargeted clips onto the rig s joint names', () => {
    const clips = buildFbxClipSet(syntheticTakes(), syntheticRig())!;
    const targets = new Set<string>(Object.values(RETARGET));

    for (const state of ['idle', 'fall', 'land', 'stumble']) {
      const clip = clips.find((c) => c.name === state)!;
      expect(clip.tracks.length, `${state} retargeted to nothing`).toBeGreaterThan(0);

      for (const track of clip.tracks) {
        const bone = track.name.slice(0, track.name.lastIndexOf('.'));
        expect(targets.has(bone), `${state} still targets "${bone}"`).toBe(true);
      }
    }
  });

  it('composes each key onto the bind rotation rather than replacing it', () => {
    const rig = syntheticRig();
    const bind = rig.getObjectByName('LeftUpLeg')!.quaternion.clone();

    const authored = buildCatClips().find((c) => c.name === 'land')!;
    const authoredTrack = authored.tracks.find(
      (t) => t.name === 'thighL.quaternion',
    ) as THREE.QuaternionKeyframeTrack;

    const clips = buildFbxClipSet(syntheticTakes(), rig)!;
    const retargeted = clips
      .find((c) => c.name === 'land')!
      .tracks.find((t) => t.name === 'LeftUpLeg.quaternion') as THREE.QuaternionKeyframeTrack;

    expect(retargeted).toBeDefined();

    const source = new THREE.Quaternion(
      authoredTrack.values[0],
      authoredTrack.values[1],
      authoredTrack.values[2],
      authoredTrack.values[3],
    );
    const expected = bind.clone().multiply(source);
    const actual = new THREE.Quaternion(
      retargeted.values[0],
      retargeted.values[1],
      retargeted.values[2],
      retargeted.values[3],
    );

    // Sign-insensitive: q and -q are the same rotation, and the track keeps the
    // sign continuous rather than canonical.
    expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 6);
  });

  it('stands every imported take up on the rig s own bind orientation', () => {
    // The one that laid the cat down. The takes bind to the right joints and
    // carry the right motion, but their Hips key sits near identity where this
    // rig's bind pose is pitched about 90 degrees around X - and Hips roots the
    // whole FK chain, so that single difference puts the head level with the
    // hips instead of far above them.
    //
    // It only showed up on `eat` at first, so the correction was applied only
    // there; when the rest of the takes were converted to GLB they landed in
    // the same state and spent a release running flat on their backs. Hence
    // this asserting the invariant for *every* take rather than for the one
    // that happened to break first.
    const rig = syntheticRig();
    const bind = rig.getObjectByName('Hips')!.quaternion.clone();

    const clips = buildFbxClipSet(syntheticTakes(), rig)!;

    for (const state of Object.keys(FBX_CLIP_FILES)) {
      const track = clips
        .find((c) => c.name === state)!
        .tracks.find((t) => t.name === 'Hips.quaternion') as THREE.QuaternionKeyframeTrack;

      expect(track, `${state} has no Hips track to stand up`).toBeDefined();

      const first = new THREE.Quaternion(
        track.values[0],
        track.values[1],
        track.values[2],
        track.values[3],
      );
      // Sign-insensitive, as above: q and -q are the same rotation.
      expect(
        Math.abs(first.dot(bind)),
        `${state} starts at a Hips rotation the rig was not bound in`,
      ).toBeCloseTo(1, 6);
    }
  });

  it('shifts a take s whole Hips curve rigidly, keeping the performance', () => {
    // Standing a take up must not flatten it. The correction is a single
    // premultiply, so the *relative* motion between any two frames has to come
    // through untouched - otherwise the run would stand up and stop striding.
    const takes = syntheticTakes();
    takes.run = [
      new THREE.AnimationClip('Scene', 0.6, [
        new THREE.QuaternionKeyframeTrack(
          'Hips.quaternion',
          [0, 0.3, 0.6],
          [
            0, 0, 0, 1,
            ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4).toArray(),
            ...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9).toArray(),
          ],
        ),
      ]),
    ];

    const track = buildFbxClipSet(takes, syntheticRig())!
      .find((c) => c.name === 'run')!
      .tracks.find((t) => t.name === 'Hips.quaternion') as THREE.QuaternionKeyframeTrack;

    const at = (i: number) =>
      new THREE.Quaternion(
        track.values[i * 4],
        track.values[i * 4 + 1],
        track.values[i * 4 + 2],
        track.values[i * 4 + 3],
      );

    // frame0 -> frame1 was 0.4 rad about Y, frame0 -> frame2 was 0.9.
    for (const [frame, expected] of [
      [1, 0.4],
      [2, 0.9],
    ] as const) {
      const delta = at(0).invert().multiply(at(frame));
      expect(2 * Math.acos(Math.min(1, Math.abs(delta.w)))).toBeCloseTo(expected, 5);
    }
  });

  it('falls back rather than shipping a cat missing half its states', () => {
    // A pack without the takes it is supposed to have has to be rejected here,
    // so AssetRegistry drops to the procedurally rigged model - which does have
    // a complete clip set - rather than to a cat that cannot jump.
    expect(buildFbxClipSet({}, syntheticRig())).toBeNull();

    const empty = syntheticTakes();
    empty.jump = [];
    expect(buildFbxClipSet(empty, syntheticRig())).toBeNull();
  });
});
