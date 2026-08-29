/** [helper name, source joint, distal child, maximum transferred weight]. */
export const DEFORMATION_HELPERS = [
  ['LeftArmTwist', 'LeftArm', 'LeftForeArm', 0.5],
  ['LeftForeArmTwist', 'LeftForeArm', 'LeftHand', 0.56],
  ['RightArmTwist', 'RightArm', 'RightForeArm', 0.5],
  ['RightForeArmTwist', 'RightForeArm', 'RightHand', 0.56],
  ['LeftUpLegTwist', 'LeftUpLeg', 'LeftLeg', 0.48],
  ['LeftLegTwist', 'LeftLeg', 'LeftFoot', 0.52],
  ['RightUpLegTwist', 'RightUpLeg', 'RightLeg', 0.48],
  ['RightLegTwist', 'RightLeg', 'RightFoot', 0.52],
  ['Spine01Twist', 'Spine01', 'Spine02', 0.34],
  ['Spine02Twist', 'Spine02', 'neck', 0.3],
];

export const CHARACTER_IDS = ['fox', 'cat', 'bunny', 'masked'];
