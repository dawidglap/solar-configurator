let currentCanvasRotationDeg = 0;

export function setCurrentCanvasRotationDeg(rotationDeg: number): void {
  if (Number.isFinite(rotationDeg)) currentCanvasRotationDeg = rotationDeg;
}

export function getCurrentCanvasRotationDeg(): number {
  return currentCanvasRotationDeg;
}
