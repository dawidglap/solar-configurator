declare module "clipper-lib" {
  export type ClipperPoint = { X: number; Y: number };
  export type ClipperPath = ClipperPoint[];
  export type ClipperPaths = ClipperPath[];

  export type ClipperOffsetInstance = {
    AddPath(path: ClipperPath, joinType: number, endType: number): void;
    Execute(solution: ClipperPaths, delta: number): void;
  };

  const ClipperLib: {
    Clipper: {
      Orientation(path: ClipperPath): boolean;
    };
    ClipperOffset: new (
      miterLimit?: number,
      arcTolerance?: number,
    ) => ClipperOffsetInstance;
    JoinType: {
      jtMiter: number;
    };
    EndType: {
      etClosedPolygon: number;
    };
  };

  export default ClipperLib;
}
