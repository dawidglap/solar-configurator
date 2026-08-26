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

export function computeUsableRoof(input: {
  roofPolygonM: MetricPolygon;
  marginM: number;
}): UsableRoofGeometry {
  const polygon = normalizeMetricPolygon(input.roofPolygonM);
  if (!isSimpleMetricPolygon(polygon)) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
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
      diagnostics: [
        {
          code: "invalid-margin",
          message: "Roof margin must be a finite non-negative metric value.",
        },
      ],
    };
  }
  if (input.marginM === 0) {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "valid",
      components: [polygon],
      marginM: 0,
      diagnostics: [],
    };
  }

  try {
    const offset = new ClipperLib.ClipperOffset(10, 0.25);
    offset.AddPath(
      toClipperPath(polygon),
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon,
    );
    const solution: ClipperPaths = [];
    offset.Execute(solution, -input.marginM * CLIPPER_COORDINATE_SCALE);

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
      diagnostics: [],
    };
  } catch {
    return {
      engineVersion: GEOMETRY_V2_ENGINE_VERSION,
      status: "invalid",
      components: [],
      marginM: input.marginM,
      diagnostics: [
        {
          code: "offset-failed",
          message: "The roof inset operation could not produce valid geometry.",
        },
      ],
    };
  }
}
