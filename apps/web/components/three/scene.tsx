'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';

export type SceneVariant = 'hero' | 'bars' | 'rings' | 'helix' | 'shards';

export type Palette = { a: string; b: string; c: string };
export const palettes: Record<'dark' | 'light', Palette> = {
  dark: { a: '#ff6a45', b: '#c9f26b', c: '#ffd35a' },
  light: { a: '#e2411f', b: '#7fb62a', c: '#f0a81a' },
};

/** Rotates the whole scene toward the pointer so every page feels like it has depth. */
function Rig({ children, strength = 0.35 }: { children: React.ReactNode; strength?: number }) {
  const g = useRef<Group>(null);
  const aspect = useThree((t) => t.size.width / Math.max(1, t.size.height));
  useFrame(({ pointer, clock }, dt) => {
    const o = g.current;
    if (!o) return;
    o.scale.setScalar(Math.min(1, Math.max(0.45, aspect * 0.8)));
    o.rotation.y += (pointer.x * strength - o.rotation.y) * Math.min(1, dt * 2);
    o.rotation.x += (-pointer.y * strength * 0.6 - o.rotation.x) * Math.min(1, dt * 2);
    o.position.y = Math.sin(clock.elapsedTime * 0.5) * 0.08;
  });
  return <group ref={g}>{children}</group>;
}

function Hero({ p }: { p: Palette }) {
  const knot = useRef<Group>(null);
  const orbit = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (knot.current) { knot.current.rotation.x = t * 0.18; knot.current.rotation.y = t * 0.26; }
    if (orbit.current) orbit.current.rotation.z = t * 0.4;
  });
  return (
    <>
      <group ref={knot}>
        <mesh>
          <torusKnotGeometry args={[1, 0.34, 220, 28, 2, 3]} />
          <meshStandardMaterial color={p.a} roughness={0.25} metalness={0.6} emissive={p.a} emissiveIntensity={0.18} />
        </mesh>
        <mesh scale={1.22}>
          <torusKnotGeometry args={[1, 0.34, 90, 10, 2, 3]} />
          <meshBasicMaterial color={p.b} wireframe transparent opacity={0.22} />
        </mesh>
      </group>
      <group ref={orbit}>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0]}>
              <sphereGeometry args={[0.12 + (i % 2) * 0.06, 24, 24]} />
              <meshStandardMaterial color={i % 2 ? p.b : p.c} roughness={0.3} metalness={0.4} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}

function Bars({ p }: { p: Palette }) {
  const refs = useRef<(Group | null)[]>([]);
  const cells = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ x: (i % 6) - 2.5, z: Math.floor(i / 6) - 2.5, ph: (i * 1.7) % 6.28 })), []);
  useFrame(({ clock }) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      const h = 0.4 + (Math.sin(clock.elapsedTime * 0.9 + cells[i]!.ph) + 1) * 0.55;
      g.scale.y = h;
      g.position.y = h / 2 - 1.1;
    });
  });
  return (
    <group rotation={[0.55, -0.6, 0]} scale={0.85}>
      {cells.map((c, i) => (
        <group key={i} position={[c.x * 0.62, 0, c.z * 0.62]} ref={(el) => { refs.current[i] = el; }}>
          <mesh>
            <boxGeometry args={[0.44, 1, 0.44]} />
            <meshStandardMaterial color={i % 5 === 0 ? p.b : i % 3 === 0 ? p.c : p.a} roughness={0.35} metalness={0.45} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Rings({ p }: { p: Palette }) {
  const refs = useRef<(Group | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      const t = clock.elapsedTime * (0.25 + i * 0.12) * (i % 2 ? -1 : 1);
      g.rotation.x = t + i;
      g.rotation.y = t * 0.7;
    });
  });
  const cols = [p.a, p.b, p.c, p.a];
  return (
    <>
      {cols.map((c, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el; }}>
          <mesh>
            <torusGeometry args={[0.8 + i * 0.5, 0.035 + (i === 0 ? 0.03 : 0), 16, 120]} />
            <meshStandardMaterial color={c} roughness={0.25} metalness={0.7} emissive={c} emissiveIntensity={0.25} />
          </mesh>
        </group>
      ))}
      <mesh>
        <icosahedronGeometry args={[0.38, 2]} />
        <meshStandardMaterial color={p.a} roughness={0.3} metalness={0.5} emissive={p.a} emissiveIntensity={0.4} />
      </mesh>
    </>
  );
}

function Helix({ p }: { p: Palette }) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => { if (g.current) g.current.rotation.y = clock.elapsedTime * 0.3; });
  const pts = useMemo(() => Array.from({ length: 44 }, (_, i) => { const a = i * 0.42; return { a, y: (i - 22) * 0.12 }; }), []);
  return (
    <group ref={g} rotation={[0.2, 0, 0.35]}>
      {pts.map(({ a, y }, i) => (
        <group key={i}>
          <mesh position={[Math.cos(a) * 1.1, y, Math.sin(a) * 1.1]}>
            <boxGeometry args={[0.16, 0.08, 0.16]} />
            <meshStandardMaterial color={p.a} roughness={0.3} metalness={0.5} />
          </mesh>
          <mesh position={[Math.cos(a + Math.PI) * 1.1, y, Math.sin(a + Math.PI) * 1.1]}>
            <boxGeometry args={[0.16, 0.08, 0.16]} />
            <meshStandardMaterial color={p.b} roughness={0.3} metalness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Shards({ p }: { p: Palette }) {
  const refs = useRef<(Group | null)[]>([]);
  const items = useMemo(
    () => Array.from({ length: 9 }, (_, i) => ({
      pos: [Math.cos(i * 2.4) * (1.2 + (i % 3) * 0.7), Math.sin(i * 1.9) * 1.5, -((i % 4) * 0.5)] as [number, number, number],
      s: 0.22 + (i % 3) * 0.12, sp: 0.2 + (i % 5) * 0.07,
    })),
    [],
  );
  useFrame(({ clock }) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      const t = clock.elapsedTime * items[i]!.sp;
      g.rotation.set(t, t * 1.3, 0);
      g.position.y = items[i]!.pos[1] + Math.sin(clock.elapsedTime * 0.6 + i) * 0.15;
    });
  });
  const cols = [p.a, p.b, p.c];
  return (
    <>
      {items.map((it, i) => (
        <group key={i} position={it.pos} ref={(el) => { refs.current[i] = el; }}>
          <mesh scale={it.s * 2.2}>
            {i % 2 ? <octahedronGeometry args={[0.5, 0]} /> : <icosahedronGeometry args={[0.5, 0]} />}
            <meshStandardMaterial color={cols[i % 3]} roughness={0.3} metalness={0.5} flatShading />
          </mesh>
        </group>
      ))}
    </>
  );
}

const scenes = { hero: Hero, bars: Bars, rings: Rings, helix: Helix, shards: Shards };

export default function Scene({ variant, palette, still, pos = [0, 0, 5.2] }: { variant: SceneVariant; palette: Palette; still: boolean; pos?: [number, number, number] }) {
  const S = scenes[variant];
  return (
    <Canvas camera={{ position: pos, fov: 42 }} dpr={[1, 1.5]} frameloop={still ? 'demand' : 'always'} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} />
      <pointLight position={[-4, -2, 3]} intensity={30} color={palette.a} />
      <pointLight position={[4, 2, -2]} intensity={18} color={palette.b} />
      <Rig>
        <S p={palette} />
      </Rig>
    </Canvas>
  );
}
