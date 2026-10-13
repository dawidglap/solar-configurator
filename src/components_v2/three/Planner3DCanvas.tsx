"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type {
  Planner3DObstacle,
  Planner3DPanel,
  Planner3DMarginBand,
  Planner3DRoof,
  Planner3DSceneModel,
  Vec3,
} from "@/lib/planning-3d/types";

const COLORS = {
  roof: "#aab4b2",
  roofSelected: "#77c9bd",
  panel: "#172c38",
  panelSelected: "#18a999",
  obstacle: "#7d8786",
  snowGuard: "#c8d0d1",
  ground: "#dce2e0",
  margin: "#a94f55",
} as const;

type MutablePositions = number[];
function pushTriangle(positions: MutablePositions, a: Vec3, b: Vec3, c: Vec3) {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

function pushQuad(positions: MutablePositions, a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  pushTriangle(positions, a, b, c);
  pushTriangle(positions, a, c, d);
}

function geometryFromPositions(positions: MutablePositions): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function roofGeometry(roofs: readonly Planner3DRoof[], selected: boolean): THREE.BufferGeometry {
  const positions: MutablePositions = [];
  roofs.filter((roof) => roof.selected === selected).forEach((roof) => {
    roof.triangles.forEach(([a, b, c]) => pushTriangle(positions, roof.vertices[a], roof.vertices[b], roof.vertices[c]));
    const bottom = roof.vertices.map((vertex) => ({ ...vertex, y: vertex.y - roof.thicknessM }));
    roof.triangles.forEach(([a, b, c]) => pushTriangle(positions, bottom[c], bottom[b], bottom[a]));
    roof.vertices.forEach((vertex, index) => {
      const next = (index + 1) % roof.vertices.length;
      pushQuad(positions, vertex, bottom[index], bottom[next], roof.vertices[next]);
    });
  });
  return geometryFromPositions(positions);
}

function panelGeometry(panels: readonly Planner3DPanel[], selected: boolean): THREE.BufferGeometry {
  const positions: MutablePositions = [];
  panels.filter((panel) => panel.selected === selected).forEach((panel) => {
    const [a, b, c, d] = panel.corners;
    pushQuad(positions, a, b, c, d);
    const bottom = panel.corners.map((corner) => ({ ...corner, y: corner.y - panel.thicknessM })) as [Vec3, Vec3, Vec3, Vec3];
    pushQuad(positions, bottom[3], bottom[2], bottom[1], bottom[0]);
    pushQuad(positions, a, bottom[0], bottom[1], b);
    pushQuad(positions, b, bottom[1], bottom[2], c);
    pushQuad(positions, c, bottom[2], bottom[3], d);
    pushQuad(positions, d, bottom[3], bottom[0], a);
  });
  return geometryFromPositions(positions);
}

function obstacleGeometry(obstacles: readonly Planner3DObstacle[]): THREE.BufferGeometry {
  const positions: MutablePositions = [];
  obstacles.forEach((obstacle) => {
    obstacle.triangles.forEach(([a, b, c]) => pushTriangle(positions, obstacle.top[a], obstacle.top[b], obstacle.top[c]));
    obstacle.base.forEach((point, index) => {
      const next = (index + 1) % obstacle.base.length;
      pushQuad(positions, point, obstacle.base[next], obstacle.top[next], obstacle.top[index]);
    });
  });
  return geometryFromPositions(positions);
}

function marginBandGeometry(bands: readonly Planner3DMarginBand[]): THREE.BufferGeometry {
  const positions: MutablePositions = [];
  bands.forEach((band) => {
    const byPlanPoint = new Map<string, Vec3>();
    const remember = (point: Vec3) => {
      byPlanPoint.set(`${point.x.toFixed(9)}:${point.z.toFixed(9)}`, point);
      return new THREE.Vector2(point.x, point.z);
    };
    const contour = band.outer.map(remember);
    const holes = band.usableComponents.map((component) => component.map(remember));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const flattened = [...contour, ...holes.flat()];
    const resolve = (index: number): Vec3 => {
      const point = flattened[index];
      return byPlanPoint.get(`${point.x.toFixed(9)}:${point.y.toFixed(9)}`) ?? { x: point.x, y: 0, z: point.y };
    };
    faces.forEach(([a, b, c]) => pushTriangle(positions, resolve(a), resolve(b), resolve(c)));
  });
  return geometryFromPositions(positions);
}

function TechnicalMeshes({ scene }: { scene: Readonly<Planner3DSceneModel> }) {
  const geometries = useMemo(() => ({
    roofs: roofGeometry(scene.roofs, false),
    selectedRoofs: roofGeometry(scene.roofs, true),
    panels: panelGeometry(scene.panels, false),
    selectedPanels: panelGeometry(scene.panels, true),
    obstacles: obstacleGeometry(scene.obstacles),
    marginBands: marginBandGeometry(scene.marginBands),
  }), [scene]);

  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries]);

  return (
    <>
      <mesh geometry={geometries.roofs} castShadow receiveShadow>
        <meshStandardMaterial color={COLORS.roof} roughness={0.82} metalness={0.04} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometries.selectedRoofs} castShadow receiveShadow>
        <meshStandardMaterial color={COLORS.roofSelected} roughness={0.76} metalness={0.04} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometries.panels} castShadow>
        <meshStandardMaterial color={COLORS.panel} roughness={0.34} metalness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometries.selectedPanels} castShadow>
        <meshStandardMaterial color={COLORS.panelSelected} roughness={0.34} metalness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometries.obstacles} castShadow receiveShadow>
        <meshStandardMaterial color={COLORS.obstacle} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometries.marginBands} renderOrder={2}>
        <meshBasicMaterial
          color={COLORS.margin}
          transparent
          opacity={0.38}
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
      {scene.snowGuards.map((guard) => (
        <SnowGuardMesh key={guard.id} start={guard.start} end={guard.end} width={guard.widthM} railHeight={guard.railHeightM} />
      ))}
    </>
  );
}

function SnowGuardMesh({ start, end, width, railHeight }: { start: Vec3; end: Vec3; width: number; railHeight: number }) {
  const transform = useMemo(() => {
    const from = new THREE.Vector3(start.x, start.y, start.z);
    const to = new THREE.Vector3(end.x, end.y, end.z);
    const direction = to.clone().sub(from);
    const length = direction.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
    return { position: from.add(to).multiplyScalar(0.5), rotation, length };
  }, [end, start]);
  return (
    <group position={transform.position} quaternion={transform.rotation}>
      <mesh castShadow>
        <boxGeometry args={[transform.length, 0.035, width]} />
        <meshStandardMaterial color={COLORS.snowGuard} metalness={0.72} roughness={0.3} />
      </mesh>
      <mesh position={[0, railHeight / 2, 0]} castShadow>
        <boxGeometry args={[transform.length, railHeight, 0.035]} />
        <meshStandardMaterial color={COLORS.snowGuard} metalness={0.8} roughness={0.25} />
      </mesh>
    </group>
  );
}

function CameraController({ scene, resetVersion }: { scene: Readonly<Planner3DSceneModel>; resetVersion: number }) {
  const { camera, controls, invalidate } = useThree();
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current && resetVersion === 0) return;
    initialized.current = true;
    const { min, max } = scene.bounds;
    const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    const size = new THREE.Vector3(max.x - min.x, max.y - min.y, max.z - min.z);
    const radius = Math.max(2, size.length() / 2);
    const perspective = camera as THREE.PerspectiveCamera;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(perspective.fov / 2)) * 1.18;
    const direction = new THREE.Vector3(1, 0.82, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    perspective.near = Math.max(0.01, distance / 1000);
    perspective.far = Math.max(100, distance * 12);
    perspective.updateProjectionMatrix();
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
    orbit?.target?.copy(center);
    orbit?.update?.();
    camera.lookAt(center);
    invalidate();
  }, [camera, controls, invalidate, resetVersion, scene]);
  return null;
}

export default function Planner3DCanvas({ scene, resetVersion }: { scene: Readonly<Planner3DSceneModel>; resetVersion: number }) {
  const width = scene.bounds.max.x - scene.bounds.min.x;
  const depth = scene.bounds.max.z - scene.bounds.min.z;
  const groundSize = Math.max(12, width, depth) * 1.6;
  return (
    <Canvas camera={{ fov: 42, near: 0.01, far: 1000 }} frameloop="demand" shadows dpr={[1, 1.5]}>
      <color attach="background" args={["#e8eceb"]} />
      <ambientLight intensity={1.55} />
      <directionalLight position={[12, 18, 8]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <TechnicalMeshes scene={scene} />
      <gridHelper args={[groundSize, Math.max(10, Math.round(groundSize)), "#aeb8b5", "#cbd2d0"]} position={[0, scene.groundY + 0.002, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, scene.groundY, 0]} receiveShadow>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshStandardMaterial color={COLORS.ground} roughness={1} />
      </mesh>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1} maxPolarAngle={Math.PI * 0.495} />
      <CameraController scene={scene} resetVersion={resetVersion} />
    </Canvas>
  );
}
