export const REFERENCE_EDGE_REMINDER_DURATION_MS = 5_000;
export const REFERENCE_EDGE_REMINDER_TEXT =
  "Tipp: Wähle die gewünschte Referenzkante, damit die Module automatisch optimal ausgerichtet werden.";

const VIEWPORT_EPSILON = 1e-6;

export function isPlannerMapReady(input: {
  hydrationReady: boolean;
  step: string;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  fitScale: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}): boolean {
  if (!input.hydrationReady || (input.step !== "building" && input.step !== "modules")) {
    return false;
  }
  const dimensions = [
    input.imageWidth,
    input.imageHeight,
    input.viewportWidth,
    input.viewportHeight,
  ];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) return false;
  if (
    !Number.isFinite(input.fitScale) ||
    !Number.isFinite(input.scale) ||
    !Number.isFinite(input.offsetX) ||
    !Number.isFinite(input.offsetY)
  ) return false;

  const expectedFitScale = Math.max(
    input.viewportWidth / input.imageWidth,
    input.viewportHeight / input.imageHeight,
  );
  const expectedOffsetX = (input.viewportWidth - input.imageWidth * expectedFitScale) / 2;
  const expectedOffsetY = (input.viewportHeight - input.imageHeight * expectedFitScale) / 2;
  return (
    Math.abs(input.fitScale - expectedFitScale) <= VIEWPORT_EPSILON &&
    Math.abs(input.scale - expectedFitScale) <= VIEWPORT_EPSILON &&
    Math.abs(input.offsetX - expectedOffsetX) <= VIEWPORT_EPSILON &&
    Math.abs(input.offsetY - expectedOffsetY) <= VIEWPORT_EPSILON
  );
}
