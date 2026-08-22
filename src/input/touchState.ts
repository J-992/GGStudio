export interface TouchState {
  p1l: boolean;
  p1r: boolean;
  p1j: boolean;
  p2l: boolean;
  p2r: boolean;
  p2j: boolean;
  p1jLatch: boolean;
  p2jLatch: boolean;
}

export const touchState: TouchState = {
  p1l: false,
  p1r: false,
  p1j: false,
  p2l: false,
  p2r: false,
  p2j: false,
  p1jLatch: false,
  p2jLatch: false,
};
