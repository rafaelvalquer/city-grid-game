export const MAP_COLORS = {
  bg: 0xbfe7d5,
  void: 0x9bd9e7,
  block: 0xcce6b7,
  blockAlt: 0xbddaa5,
  grid: 0x8cc7bd,
  lotStroke: 0x9cbf9c,
  sidewalk: 0xf7f3e8,
  road: 0x46536b,
  roadEdge: 0x30394b,
  avenue: 0x344057,
  avenueEdge: 0x20283a,
  lane: 0xf6d46f,
  laneSoft: 0xf9f3d0,
  house: 0xff5b82,
  houseRoof: 0xc12d67,
  shop: 0xffbd4a,
  shopAwning: 0xff7a4f,
  office: 0x55c7e9,
  officeGlass: 0xd3fbff,
  disconnected: 0xf04461,
  carBody: 0xfdfdf8,
  carAltA: 0xff5b82,
  carAltB: 0x52c7e8,
  carAltC: 0xffbd4a,
  carWindow: 0x31405a,
  route: 0xff7197,
  selection: 0xffffff,
  previewValid: 0x18c6a7,
  previewInvalid: 0xf04461,
  shadow: 0x263143,
};

export function congestionColor(value: number): number {
  if (value < 0.45) return 0x3ddc84;
  if (value < 0.85) return 0xfacc15;
  if (value < 1.25) return 0xfb923c;
  return 0xf87171;
}
