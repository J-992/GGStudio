/**
 * Cubic Hermite interpolation for hand-authored motion tracks.
 *
 * The old animation sampler used smootherstep independently between every two
 * keys. That is position-continuous but forces velocity to zero at every key,
 * which makes a body visibly tick through a sequence of poses. These tangents
 * preserve velocity through keys that continue in the same direction and stop
 * only at a genuine reversal (anticipation, overshoot, or recovery).
 */

export type EndpointMotion = 'rest' | 'moving';

export function cubicMotion(
  previous: number,
  from: number,
  to: number,
  next: number,
  previousTime: number,
  fromTime: number,
  toTime: number,
  nextTime: number,
  local: number,
  hasPrevious: boolean,
  hasNext: boolean,
  endpoints: EndpointMotion = 'rest',
): number {
  const span = Math.max(1e-6, toTime - fromTime);
  const beforeSpan = Math.max(1e-6, fromTime - previousTime);
  const afterSpan = Math.max(1e-6, nextTime - toTime);
  const segmentSlope = (to - from) / span;

  const fromSlope = hasPrevious
    ? naturalTangent((from - previous) / beforeSpan, segmentSlope, beforeSpan, span)
    : endpoints === 'moving'
      ? segmentSlope
      : 0;
  const toSlope = hasNext
    ? naturalTangent(segmentSlope, (next - to) / afterSpan, span, afterSpan)
    : endpoints === 'moving'
      ? segmentSlope
      : 0;

  const u = local < 0 ? 0 : local > 1 ? 1 : local;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * from + h10 * fromSlope * span + h01 * to + h11 * toSlope * span;
}

function naturalTangent(
  incoming: number,
  outgoing: number,
  incomingSpan: number,
  outgoingSpan: number,
): number {
  // A sign change is an intentional extremum: settle there instead of
  // overshooting the anatomical pose authored by the animator.
  if (incoming === 0 || outgoing === 0 || Math.sign(incoming) !== Math.sign(outgoing)) return 0;

  // Time-weighted cardinal tangent. The modest tension keeps rotations from
  // ballooning between short anticipation keys and longer recovery keys.
  const weighted =
    (incoming * outgoingSpan + outgoing * incomingSpan) /
    Math.max(1e-6, incomingSpan + outgoingSpan);
  return weighted * 0.72;
}
