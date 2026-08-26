import * as THREE from "three";

export enum Orientation {
  Floor = 0,
  RightWall = 1,
  Ceiling = 2,
  LeftWall = 3,
}

const UPS: THREE.Vector3[] = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
];

export const FORWARD = new THREE.Vector3(0, 0, -1);

export interface SurfaceFrame {
  up: THREE.Vector3;
  right: THREE.Vector3;
  rollQuat: THREE.Quaternion;
}

const frameCache = new Map<Orientation, SurfaceFrame>();

export function getFrame(o: Orientation): SurfaceFrame {
  let f = frameCache.get(o);
  if (!f) {
    const up = UPS[o].clone();
    const right = FORWARD.clone().cross(up).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (o * Math.PI) / 2);
    f = { up, right, rollQuat: q };
    frameCache.set(o, f);
  }
  return f;
}

export function stepOrientation(o: Orientation, dir: number): Orientation {
  return (((o + dir) % 4) + 4) % 4 as Orientation;
}
