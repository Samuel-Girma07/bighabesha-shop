import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const TelegramPremium3DStar: React.FC<{ className?: string; height?: number }> = ({
  className,
  height = 170,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 340;
    const sceneHeight = height;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / sceneHeight, 0.1, 100);
    camera.position.set(0, 0, 5.2);

    // Renderer with Alpha & Antialiasing
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, sceneHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 1. Create 5-Pointed Telegram Star 3D Geometry
    const starShape = new THREE.Shape();
    const points = 5;
    const outerRadius = 1.45;
    const innerRadius = 0.68;
    const angleStep = Math.PI / points;

    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = i * angleStep - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        starShape.moveTo(x, y);
      } else {
        starShape.lineTo(x, y);
      }
    }
    starShape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.38,
      bevelEnabled: true,
      bevelSegments: 8,
      steps: 2,
      bevelSize: 0.12,
      bevelThickness: 0.12,
    };

    const geometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    geometry.center();

    // 2. High-Gloss Metallic/Glass Material (Telegram Purple/Blue Iridescence)
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#8B5CF6'),
      emissive: new THREE.Color('#3B0764'),
      emissiveIntensity: 0.35,
      metalness: 0.45,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 1.0,
      transmission: 0.1,
      ior: 1.5,
    });

    const starMesh = new THREE.Mesh(geometry, material);
    scene.add(starMesh);

    // 3. Cosmic Background Particles (Sparkling Stars)
    const particleCount = 75;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleScales = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 8;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 5;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.5;
      particleScales[i] = Math.random() * 0.8 + 0.2;
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('scale', new THREE.BufferAttribute(particleScales, 1));

    const particleMaterial = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.045,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // 4. Lights: Cyan + Violet Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x38bdf8, 3.5, 12);
    cyanLight.position.set(3, 2, 4);
    scene.add(cyanLight);

    const purpleLight = new THREE.PointLight(0xa855f7, 3.2, 12);
    purpleLight.position.set(-3, -2, 3);
    scene.add(purpleLight);

    const topRimLight = new THREE.DirectionalLight(0xe0e7ff, 1.8);
    topRimLight.position.set(0, 5, 2);
    scene.add(topRimLight);

    // 5. Interactive Touch/Mouse Tilt
    let targetRotX = 0;
    let targetRotY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.6;
      targetRotX = -y * 0.5;
    };

    const handlePointerLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);

    // 6. Animation Loop (Smooth Floating & Rotation)
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Floating bobbing
      starMesh.position.y = Math.sin(elapsed * 1.8) * 0.12;

      // Base rotation + interactive tilt inertia
      starMesh.rotation.y += (Math.sin(elapsed * 0.8) * 0.4 + targetRotY - starMesh.rotation.y) * 0.08;
      starMesh.rotation.x += (Math.cos(elapsed * 1.1) * 0.25 + targetRotX - starMesh.rotation.x) * 0.08;
      starMesh.rotation.z = Math.sin(elapsed * 1.4) * 0.08;

      // Gentle star particles twinkle drift
      particles.rotation.y = elapsed * 0.04;
      particles.rotation.x = Math.sin(elapsed * 0.05) * 0.05;

      renderer.render(scene, camera);
    };

    animate();

    // 7. Handle Resize
    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth || 340;
      camera.aspect = newWidth / sceneHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, sceneHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      cancelAnimationFrame(animationFrameId);

      geometry.dispose();
      material.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [height]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl overflow-hidden mb-3 bg-[#080D17] border border-white/10 shadow-xl flex items-center justify-center cursor-grab active:cursor-grabbing ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        borderRadius: '16px',
        overflow: 'hidden',
        marginBottom: '14px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'radial-gradient(ellipse at 50% 40%, #151A2E 0%, #080D17 100%)',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '0',
          right: '0',
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
          Telegram Premium
        </div>
        <div style={{ fontSize: '11.5px', color: '#94A3B8' }}>
          Go beyond limits with double quotas & exclusive 3D badges
        </div>
      </div>
    </div>
  );
};
