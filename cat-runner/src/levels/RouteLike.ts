import type * as THREE from 'three';

/**
 * The spine a run is measured against.
 *
 * Two jobs, exactly as `ChaseRoute` already does them: it is the path the
 * pursuers advance a scalar along, and it is the yardstick that turns "where is
 * the cat" into a single number for the chase logic, the HUD and the debug
 * panel.
 *
 * It exists as an interface because the endless track's spine is a straight
 * line, and evaluating a Catmull-Rom sample table to answer "z minus the start"
 * would be silly. Every consumer - `Pursuer`, `Dog`, `RestaurantOwner`, `Game` -
 * only ever calls the six members below, so they neither know nor care which
 * implementation they were handed.
 */
export interface RouteLike {
  /** Arc length of the whole route. */
  readonly totalLength: number;

  /**
   * World position at an arc-length distance.
   *
   * Distances outside `[0, totalLength]` must be **extrapolated** along the end
   * tangent, not clamped: pursuers start at a negative distance and clamping
   * would pile them all onto the route's first point.
   */
  getPositionAt(distance: number, out: THREE.Vector3): THREE.Vector3;

  /** Unit tangent at an arc-length distance. Used to face the pursuers. */
  getDirectionAt(distance: number, out: THREE.Vector3): THREE.Vector3;

  /** Projects a world position onto the route and returns its arc length. */
  projectDistance(position: THREE.Vector3): number;

  /** Player progress as a 0..1 fraction of the route. */
  progressAt(position: THREE.Vector3): number;

  /** How far a position sits from the route. Detects off-route play. */
  distanceFromRoute(position: THREE.Vector3): number;

  /** Debug visualisation. Caller owns disposal. */
  createDebugLine(color?: number): THREE.Line;
}
