import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import * as THREE from "three";
import type { CaseKind } from "../data/covenant";

type CovenantSceneProps = {
  mode: CaseKind;
};

const modeColor: Record<CaseKind, string> = {
  allowed: "#44ff99",
  blocked: "#ffcf5a",
  slashed: "#ff5f5a",
  revived: "#86f7ff",
};

function GridFloor({ mode }: CovenantSceneProps) {
  const grid = useMemo(() => new THREE.GridHelper(26, 34, modeColor[mode], "#173125"), [mode]);
  grid.position.y = -2.25;
  grid.material.transparent = true;
  grid.material.opacity = 0.32;
  return <primitive object={grid} />;
}

function CovenantCore({ mode }: CovenantSceneProps) {
  const group = useRef<Group>(null);
  const inner = useRef<Mesh>(null);
  const color = modeColor[mode];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (group.current) {
      group.current.rotation.y = t * 0.18;
      group.current.rotation.x = Math.sin(t * 0.23) * 0.08;
    }
    if (inner.current) {
      inner.current.rotation.z = -t * 0.44;
      inner.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.035);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={inner}>
        <octahedronGeometry args={[1.55, 1]} />
        <meshStandardMaterial color="#f5fff7" emissive={color} emissiveIntensity={0.55} roughness={0.38} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.4, 0.018, 10, 140]} />
        <meshBasicMaterial color={color} transparent opacity={0.78} />
      </mesh>
      <mesh rotation={[0.82, 0.12, 0.4]}>
        <torusGeometry args={[3.05, 0.014, 10, 140]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.34} />
      </mesh>
      <mesh rotation={[1.9, 0.4, 1.15]}>
        <torusGeometry args={[3.62, 0.012, 10, 140]} />
        <meshBasicMaterial color={color} transparent opacity={0.24} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[3.1, 0.035, 0.035]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 4]}>
        <boxGeometry args={[3.1, 0.035, 0.035]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

function AgentOrbit({ index, mode }: CovenantSceneProps & { index: number }) {
  const ref = useRef<Group>(null);
  const color = index === 2 && mode === "revived" ? "#86f7ff" : index === 1 && mode !== "allowed" ? "#ffcf5a" : "#44ff99";
  const radius = 5.5 + index * 0.55;
  const phase = index * 1.9;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * (0.16 + index * 0.018) + phase;
    if (!ref.current) return;
    ref.current.position.x = Math.cos(t) * radius;
    ref.current.position.z = Math.sin(t) * radius * 0.48;
    ref.current.position.y = Math.sin(t * 1.3) * 0.4 - 0.1;
  });

  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.18 + index * 0.02, 18, 18]} />
        <meshStandardMaterial color="#0d1511" emissive={color} emissiveIntensity={1.4} roughness={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.009, 8, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

function SignalField({ mode }: CovenantSceneProps) {
  const points = useMemo(() => {
    const positions = new Float32Array(360 * 3);
    for (let i = 0; i < 360; i += 1) {
      const radius = 4 + Math.random() * 8;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -1.8 + Math.random() * 5.3;
      positions[i * 3 + 2] = Math.sin(angle) * radius * 0.72;
    }
    return positions;
  }, []);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: modeColor[mode],
        size: 0.028,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      }),
    [mode],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
    return geo;
  }, [points]);

  return <points geometry={geometry} material={material} />;
}

export function CovenantScene({ mode }: CovenantSceneProps) {
  return (
    <div className="scene-canvas" aria-hidden="true">
      <Canvas camera={{ position: [0, 4.6, 11.8], fov: 43 }} dpr={[1, 1.7]}>
        <color attach="background" args={["#030504"]} />
        <fog attach="fog" args={["#030504", 8, 23]} />
        <ambientLight intensity={0.62} />
        <pointLight position={[4, 5, 3]} color={modeColor[mode]} intensity={18} distance={12} />
        <pointLight position={[-5, 3, -4]} color="#ffffff" intensity={3.5} distance={13} />
        <GridFloor mode={mode} />
        <SignalField mode={mode} />
        <CovenantCore mode={mode} />
        {[0, 1, 2, 3, 4].map((index) => (
          <AgentOrbit key={index} index={index} mode={mode} />
        ))}
      </Canvas>
    </div>
  );
}
