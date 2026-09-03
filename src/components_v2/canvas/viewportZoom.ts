export type ViewportView = {
  scale?: number;
  fitScale?: number;
  offsetX?: number;
  offsetY?: number;
};

export type ViewportSize = { w: number; h: number };
export type ImageSize = { width: number; height: number };

export function getViewportScaleBounds(fitScale?: number) {
  const minScale = fitScale && fitScale > 0 ? fitScale : 1;
  return { minScale, maxScale: minScale * 8 };
}

export function clampViewportScale(scale: number, fitScale?: number) {
  const { minScale, maxScale } = getViewportScaleBounds(fitScale);
  return Math.max(minScale, Math.min(maxScale, scale));
}

export function clampViewportOffset(input: {
  scale: number;
  offsetX: number;
  offsetY: number;
  viewport: ViewportSize;
  image: ImageSize;
}) {
  const scaledWidth = input.image.width * input.scale;
  const scaledHeight = input.image.height * input.scale;
  let offsetX = input.offsetX;
  let offsetY = input.offsetY;

  if (scaledWidth <= input.viewport.w) offsetX = (input.viewport.w - scaledWidth) / 2;
  if (scaledHeight <= input.viewport.h) offsetY = (input.viewport.h - scaledHeight) / 2;

  return {
    x: Math.max(Math.min(0, input.viewport.w - scaledWidth), Math.min(0, offsetX)),
    y: Math.max(Math.min(0, input.viewport.h - scaledHeight), Math.min(0, offsetY)),
  };
}

export function zoomViewportAroundPoint(input: {
  view: ViewportView;
  targetScale: number;
  point: { x: number; y: number };
  viewport: ViewportSize;
  image: ImageSize;
}) {
  const oldScale = input.view.scale || input.view.fitScale || 1;
  const scale = clampViewportScale(input.targetScale, input.view.fitScale);
  const worldX = (input.point.x - (input.view.offsetX || 0)) / oldScale;
  const worldY = (input.point.y - (input.view.offsetY || 0)) / oldScale;
  const offset = clampViewportOffset({
    scale,
    offsetX: input.point.x - worldX * scale,
    offsetY: input.point.y - worldY * scale,
    viewport: input.viewport,
    image: input.image,
  });
  return { scale, offsetX: offset.x, offsetY: offset.y };
}

export function scaleToSliderPercent(scale: number, fitScale?: number) {
  const { minScale, maxScale } = getViewportScaleBounds(fitScale);
  const clamped = clampViewportScale(scale, fitScale);
  return (Math.log(clamped / minScale) / Math.log(maxScale / minScale)) * 100;
}

export function sliderPercentToScale(percent: number, fitScale?: number) {
  const { minScale, maxScale } = getViewportScaleBounds(fitScale);
  const normalized = Math.max(0, Math.min(100, percent)) / 100;
  return minScale * Math.pow(maxScale / minScale, normalized);
}
