import ClipperLib, {
  type ClipperPath,
  type ClipperPaths,
} from "clipper-lib";

import {
  GEOMETRY_AREA_EPSILON_M2,
  GEOMETRY_V2_ENGINE_VERSION,
  type MetricPolygon,
  type UsableRoofGeometry,
} from "./types";
import {
  isSimpleMetricPolygon,
  normalizeMetricPolygon,
  polygonArea,
  polygonBounds,
} from "./polygon";

const CLIPPER_COORDINATE_SCALE = 1_000_000;

function toClipperPath(polygon: MetricPolygon): ClipperPath {
  const path = polygon.map((point) => ({
    X: Math.round(point.x * CLIPPER_COORDINATE_SCALE),
    Y: Math.round(point.y * CLIPPER_COORDINATE_SCALE),
  }));
  return ClipperLib.Clipper.Orientation(path) ? path : [...path].reverse();
}

function fromClipperPath(path: ClipperPath): MetricPolygon {
  return normalizeMetricPolygon(
    path.map((point) => ({
      x: point.X / CLIPPER_COORDINATE_SCALE,
      y: point.Y / CLIPPER_COORDINATE_SCALE,
    })),
  );
}

function deterministicComponents(components: MetricPolygon[]): MetricPolygon[] {
  return [...components].sort((first, second) => {
    const firstBounds = polygonBounds(first);
    const secondBounds = polygonBounds(second);
    return (
      firstBounds.minY - secondBounds.minY ||
      firstBounds.minX - secondBounds.minX ||
      polygonArea(second) - polygonArea(first)
    );
  });
}

function offsetUniformPolygon(polygon: MetricPolygon, marginM: number): ClipperPaths {
  const offset = new ClipperLib.ClipperOffset(10, 0.25);
  offset.AddPath(
    toClipperPath(polygon),
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: ClipperPaths = [];
  offset.Execute(solution, -marginM * CLIPPER_COORDINATE_SCALE);
  return solution;
}

/**
 * Removes the independently sized inward boundary band of every finite edge.
 * Open-square buffers stay local to their source segment, so concave and
 * irregular roofs are not clipped by an unrelated infinite edge line.
 */
function offsetPolygonPerEdge(
  polygon: MetricPolygon,
  edgeMarginsM: readonly number[],
): ClipperPaths {
  const boundaryBands: ClipperPaths = [];
  edgeMarginsM.forEach((marginM, edgeIndex) => {
    if (marginM <= 0) return;
    const start = polygon[edgeIndex];
    const end = polygon[(edgeIndex + 1) % polygon.length];
    const offset = new ClipperLib.ClipperOffset(10, 0.25);
    offset.AddPath(
      [start, end].map((point) => ({
        X: Math.round(point.x * CLIPPER_COORDINATE_SCALE),
        Y: Math.round(point.y * CLIPPER_COORDINATE_SCALE),
      })),
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etOpenSquare,
    );
    const edgeBand: ClipperPaths = [];
    offset.Execute(edgeBand, marginM * CLIPPER_COORDINATE_SCALE);
    boundaryBands.push(...edgeBand);
  });
  if (!boundaryBands.length) return [toClipperPath(polygon)];

  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(toClipperPath(polygon), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(boundaryBands, ClipperLib.PolyType.ptClip, true);
  const solution: ClipperPaths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return solution;
}

export function computeUsableRoof(input: {
  roofPolygonM: MetricPolygon;
  marginM: number;
  edgeMarginsM?: readonly number[];
}): UsableRoofGeometry {
  const polygon = normalizeMetricPolygon(input.roofPolygonM);
  const edgeMarginsM = input.edgeMarginsM ? [...input.edgeMarginsM] : undefined;
  if (!isSimpleMetricPolygon(polygon)) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
      ...(edgeMarginsM ? { edgeMarginsM } : {}),
      diagnostics: [
        {
          code: "invalid-polygon",
          message: "Roof polygon must be finite, simple and have a non-zero area.",
        },
      ],
    };
  }
  if (!Number.isFinite(input.marginM) || input.marginM < 0) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
      ...(edgeMarginsM ? { edgeMarginsM } : {}),
      diagnostics: [
        {
          code: "invalid-margin",
          message: "Roof margin must be a finite non-negative metric value.",
        },
      ],
    };
  }
  if (
    edgeMarginsM &&
    (edgeMarginsM.length !== polygon.length ||
      edgeMarginsM.some((marginM) => !Number.isFinite(marginM) || marginM < 0))
  ) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
      edgeMarginsM,
      diagnostics: [
        {
          code: "invalid-margin",
          message: "Every canonical roof edge requires a finite non-negative metric margin.",
        },
      ],
    };
  }
  const effectiveUniformMarginM = edgeMarginsM?.length && edgeMarginsM.every(
    (marginM) => Math.abs(marginM - edgeMarginsM[0]) <= 1e-9,
  )
    ? edgeMarginsM[0]
    : undefined;
  if ((edgeMarginsM ? edgeMarginsM.every((marginM) => marginM === 0) : input.marginM === 0)) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "valid",
      components: [polygon],
      marginM: edgeMarginsM ? input.marginM : 0,
      ...(edgeMarginsM ? { edgeMarginsM } : {}),
      diagnostics: [],
    };
  }

  try {
    const solution = effectiveUniformMarginM !== undefined
      ? offsetUniformPolygon(polygon, effectiveUniformMarginM)
      : edgeMarginsM
        ? offsetPolygonPerEdge(polygon, edgeMarginsM)
        : offsetUniformPolygon(polygon, input.marginM);

    const components = deterministicComponents(
      solution
        .map(fromClipperPath)
        .filter(
          (component) =>
            component.length >= 3 &&
            polygonArea(component) > GEOMETRY_AREA_EPSILON_M2,
        ),
    );

    if (!components.length) {
      return {
        engineVersion: GEOMETRY_V2_ENGINE_VERSION,
        status: "empty",
        components: [],
        marginM: input.marginM,
        ...(edgeMarginsM ? { edgeMarginsM } : {}),
        diagnostics: [
          {
            code: "margin-consumed-roof",
            message: "The requested margin leaves no usable roof component.",
          },
        ],
      };
    }

    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "valid",
      components,
      marginM: input.marginM,
      ...(edgeMarginsM ? { edgeMarginsM } : {}),
      diagnostics: [],
    };
  } catch {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
      ...(edgeMarginsM ? { edgeMarginsM } : {}),
      diagnostics: [
        {
          code: "offset-failed",
          message: "The roof inset operation could not produce valid geometry.",
        },
      ],
    };
  }
}
