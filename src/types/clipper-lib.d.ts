declare module "clipper-lib" {
  export type ClipperPoint = { X: number; Y: number };
  export type ClipperPath = ClipperPoint[];
  export type ClipperPaths = ClipperPath[];

  export type ClipperOffsetInstance = {
    AddPath(path: ClipperPath, joinType: number, endType: number): void;
    Execute(solution: ClipperPaths, delta: number): void;
  };

  export type ClipperInstance = {
    AddPath(path: ClipperPath, polyType: number, closed: boolean): boolean;
    AddPaths(paths: ClipperPaths, polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: ClipperPaths,
      subjectFillType?: number,
      clipFillType?: number,
    ): boolean;
  };

  const ClipperLib: {
    Clipper: (new () => ClipperInstance) & {
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
      etOpenSquare: number;
    };
    PolyType: {
      ptSubject: number;
      ptClip: number;
    };
    ClipType: {
      ctDifference: number;
    };
    PolyFillType: {
      pftNonZero: number;
    };
  };

  export default ClipperLib;
}
