import * as THREE from "three";

let shared: THREE.CanvasTexture | null = null;

/**
 * A soft radial falloff, drawn once and shared. Used as the aura behind the
 * showier skins — a back-facing box reads as a slab from the front, which is not
 * what a halo is supposed to look like.
 */
export function glowTexture(): THREE.CanvasTexture {
  if (shared) return shared;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  shared = new THREE.CanvasTexture(c);
  return shared;
}

/** A camera-facing aura sized for one robot. */
export function makeGlowSprite(color: number, scale = 1.9): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  s.position.y = 0.42;
  return s;
}
