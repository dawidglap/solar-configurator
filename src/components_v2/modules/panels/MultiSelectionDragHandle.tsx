'use client';

import React from 'react';
import { Circle, Group, Label, Path, Tag, Text } from 'react-konva';
import type Konva from 'konva';

import { plannerTheme } from '../../theme/plannerTheme';

const HANDLE_SIZE_PX = 40;
const ICON_SIZE_PX = 20;

const HAND_PATHS = [
  'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
  'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
  'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
] as const;

type Props = {
  x: number;
  y: number;
  inverseScale: number;
  canvasRotationDeg: number;
  active: boolean;
  onStart: (event: Konva.KonvaEventObject<PointerEvent>) => void;
};

function setStageCursor(node: Konva.Node, cursor: 'grab' | 'grabbing' | 'default'): void {
  const container = node.getStage()?.container();
  if (container) container.style.cursor = cursor;
}

const MultiSelectionDragHandle = React.memo(function MultiSelectionDragHandle({
  x,
  y,
  inverseScale,
  canvasRotationDeg,
  active,
  onStart,
}: Props) {
  const handleRef = React.useRef<Konva.Group>(null);
  const [hovered, setHovered] = React.useState(false);
  const scale = inverseScale;
  const iconScale = (ICON_SIZE_PX / 24) * scale;
  const emphasized = hovered || active;

  React.useLayoutEffect(() => {
    const node = handleRef.current;
    const parent = node?.getParent();
    const stage = node?.getStage();
    if (!node || !parent || !stage) return;

    const parentTransform = parent.getAbsoluteTransform().copy();
    const screenPoint = parentTransform.point({ x, y });
    const styles = getComputedStyle(document.body);
    const sidebarWidth = Number.parseFloat(styles.getPropertyValue('--propW')) || 0;
    const topbarHeight = Number.parseFloat(styles.getPropertyValue('--tb')) || 0;
    const radius = HANDLE_SIZE_PX / 2;
    const safePoint = {
      x: Math.min(stage.width() - radius - 8, Math.max(sidebarWidth + radius + 8, screenPoint.x)),
      y: Math.min(stage.height() - radius - 8, Math.max(topbarHeight + radius + 48, screenPoint.y)),
    };
    const localPoint = parentTransform.invert().point(safePoint);
    node.position(localPoint);
    node.getLayer()?.batchDraw();
  }, [canvasRotationDeg, inverseScale, x, y]);

  return (
    <Group
      ref={handleRef}
      x={x}
      y={y}
      rotation={-canvasRotationDeg}
      name="interactive-panel-selection-drag-handle panel-selection-drag-handle"
      listening
      onPointerDown={(event) => {
        event.cancelBubble = true;
        event.evt.preventDefault();
        onStart(event);
      }}
      onClick={(event) => { event.cancelBubble = true; }}
      onTap={(event) => { event.cancelBubble = true; }}
      onMouseEnter={(event) => {
        setHovered(true);
        setStageCursor(event.currentTarget, active ? 'grabbing' : 'grab');
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        setStageCursor(event.currentTarget, active ? 'grabbing' : 'default');
      }}
    >
      <Circle
        radius={(HANDLE_SIZE_PX / 2) * scale}
        fill={active ? plannerTheme.primary : plannerTheme.textLight}
        stroke={emphasized ? plannerTheme.primary : plannerTheme.panelStroke}
        strokeWidth={(emphasized ? 2 : 1) * scale}
        shadowColor={plannerTheme.primaryGlow}
        shadowBlur={(active ? 14 : 10) * scale}
        shadowOpacity={active ? 0.42 : 0.2}
        shadowOffsetY={2 * scale}
      />

      {HAND_PATHS.map((data) => (
        <Path
          key={data}
          data={data}
          x={-12 * iconScale}
          y={-12 * iconScale}
          scaleX={iconScale}
          scaleY={iconScale}
          stroke={plannerTheme.panelFill}
          strokeWidth={2 / (ICON_SIZE_PX / 24)}
          lineCap="round"
          lineJoin="round"
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}

      {hovered && !active && (
        <Label x={24 * scale} y={-14 * scale} listening={false}>
          <Tag
            fill={plannerTheme.panelFill}
            stroke={plannerTheme.panelStroke}
            strokeWidth={scale}
            cornerRadius={6 * scale}
          />
          <Text
            text="Auswahl verschieben"
            fill={plannerTheme.textLight}
            fontSize={12 * scale}
            padding={7 * scale}
          />
        </Label>
      )}
    </Group>
  );
});

export default MultiSelectionDragHandle;
