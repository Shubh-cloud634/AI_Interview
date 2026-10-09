'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, Mesh } from 'three';
import type { AvatarState } from './avatar';

const speed = { listening: 0.6, thinking: 2.4, speaking: 5 } as const;
const amp = { listening: 0.03, thinking: 0.06, speaking: 0.12 } as const;

/** Soft glass core with a fine wire shell. Motion encodes state: slow breathing, fast spin, pulsing. */
function Core({ state }: { state: AvatarState }) {
  const group = useRef<Group>(null);
  const shell = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.scale.setScalar(1 + Math.sin(t * speed[state]) * amp[state]);
    g.rotation.y = t * (state === 'thinking' ? 0.9 : 0.25);
    g.rotation.x = t * 0.12;
    if (shell.current) shell.current.rotation.z = -t * 0.18;
  });
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.92, 5]} />
        <meshStandardMaterial color="#ff6a45" emissive="#b8300f" emissiveIntensity={0.45} roughness={0.28} metalness={0.55} />
      </mesh>
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.12, 1]} />
        <meshBasicMaterial color="#c9f26b" wireframe transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

export default function Orb({ state }: { state: AvatarState }) {
  return (
    <Canvas camera={{ position: [0, 0, 3.4], fov: 45 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 3, 4]} intensity={1.5} color="#ffffff" />
      <pointLight position={[-3, -2, 2]} intensity={2.2} color="#c9f26b" />
      <Core state={state} />
    </Canvas>
  );
}
