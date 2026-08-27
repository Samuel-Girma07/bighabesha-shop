import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const TelegramPremium3DStar: React.FC<{ className?: string; height?: number }> = ({
  className,
  height = 200,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 360;
    const sceneHeight = height;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / sceneHeight, 0.1, 100);
    camera.position.set(0, 0, 5.8);

    // High performance WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, sceneHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 1. High-Fidelity Chubby Telegram Premium Star Geometry
    const starShape = new THREE.Shape();

    // Top Peak (Plump rounded bulb)
    starShape.moveTo(-0.16, 1.28);
    starShape.bezierCurveTo(-0.12, 1.48, 0.12, 1.48, 0.16, 1.28);

    // Top-Right Valley
    starShape.bezierCurveTo(0.28, 0.82, 0.44, 0.52, 0.62, 0.48);

    // Right Arm (Plump bulbous horizontal point)
    starShape.bezierCurveTo(0.95, 0.42, 1.35, 0.36, 1.42, 0.18);
    starShape.bezierCurveTo(1.48, 0.02, 1.32, -0.16, 1.08, -0.28);

    // Bottom-Right Valley
    starShape.bezierCurveTo(0.82, -0.42, 0.64, -0.58, 0.66, -0.76);

    // Bottom-Right Leg (Plump rounded foot)
    starShape.bezierCurveTo(0.72, -1.05, 0.82, -1.34, 0.68, -1.48);
    starShape.bezierCurveTo(0.52, -1.62, 0.32, -1.48, 0.16, -1.26);

    // Bottom Valley
    starShape.bezierCurveTo(0.04, -1.08, -0.06, -1.02, -0.18, -1.18);

    // Bottom-Left Leg (Signature rounded swooping Telegram curve)
    starShape.bezierCurveTo(-0.38, -1.42, -0.62, -1.58, -0.82, -1.48);
    starShape.bezierCurveTo(-1.02, -1.36, -0.96, -1.08, -0.84, -0.82);
    starShape.bezierCurveTo(-0.74, -0.58, -0.68, -0.38, -0.52, -0.24);

    // The iconic Telegram Crease (folds horizontally into center at 0, 0)
    starShape.bezierCurveTo(-0.32, -0.12, -0.12, -0.04, 0.02, 0.0);
    starShape.bezierCurveTo(-0.06, 0.04, -0.24, 0.08, -0.45, 0.14);

    // Left Arm (Plump rounded wing)
    starShape.bezierCurveTo(-0.85, 0.24, -1.28, 0.32, -1.38, 0.48);
    starShape.bezierCurveTo(-1.46, 0.64, -1.28, 0.78, -0.98, 0.76);

    // Top-Left Valley connecting back to top peak
    starShape.bezierCurveTo(-0.68, 0.72, -0.48, 0.68, -0.34, 0.88);
    starShape.bezierCurveTo(-0.24, 1.05, -0.18, 1.18, -0.16, 1.28);

    // Soft pillowed 3D Extrusion
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.36,
      bevelEnabled: true,
      bevelSegments: 14,
      steps: 3,
      bevelSize: 0.16,
      bevelThickness: 0.16,
    };

    const geometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    geometry.center();

    // 2. Exact Telegram Pastel Violet-Pink to Sky-Blue Gradient Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx2d = canvas.getContext('2d')!;

    // Ultra smooth diagonal gradient matching start design.jpg
    const gradient = ctx2d.createLinearGradient(300, 50, 700, 980);
    gradient.addColorStop(0.0, '#E879F9'); // Top pastel orchid pink
    gradient.addColorStop(0.2, '#D946EF'); // Magenta rose
    gradient.addColorStop(0.48, '#A855F7'); // Core telegram purple
    gradient.addColorStop(0.75, '#60A5FA'); // Azure blue
    gradient.addColorStop(1.0, '#38BDF8'); // Electric cyan sky blue

    ctx2d.fillStyle = gradient;
    ctx2d.fillRect(0, 0, 1024, 1024);

    // Add subtle ambient rim glow in canvas
    const radialGlow = ctx2d.createRadialGradient(512, 512, 100, 512, 512, 500);
    radialGlow.addColorStop(0.0, 'rgba(255, 255, 255, 0.12)');
    radialGlow.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx2d.fillStyle = radialGlow;
    ctx2d.fillRect(0, 0, 1024, 1024);

    const gradientTexture = new THREE.CanvasTexture(canvas);
    gradientTexture.wrapS = THREE.ClampToEdgeWrapping;
    gradientTexture.wrapT = THREE.ClampToEdgeWrapping;

    // Physical Material with velvet sheen & clearcoat
    const starMaterial = new THREE.MeshPhysicalMaterial({
      map: gradientTexture,
      roughness: 0.2,
      metalness: 0.05,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      reflectivity: 0.85,
      emissive: new THREE.Color('#3B0764'),
      emissiveIntensity: 0.28,
    });

    const starMesh = new THREE.Mesh(geometry, starMaterial);
    // Natural Telegram tilt angle
    starMesh.rotation.z = -0.06;
    scene.add(starMesh);

    // 3. Mini-Star 3D Constellation (Exact 4-point & 5-point mini-stars from start design.jpg)
    const createMiniStarShape = (points = 5, outer = 0.11, inner = 0.05) => {
      const s = new THREE.Shape();
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (i * Math.PI) / points - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      s.closePath();
      return s;
    };

    const miniGeo5 = new THREE.ExtrudeGeometry(createMiniStarShape(5, 0.11, 0.048), {
      depth: 0.03,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    });
    miniGeo5.center();

    const miniGeo4 = new THREE.ExtrudeGeometry(createMiniStarShape(4, 0.09, 0.035), {
      depth: 0.02,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.01,
      bevelThickness: 0.01,
    });
    miniGeo4.center();

    const miniStarMaterial = new THREE.MeshBasicMaterial({
      color: 0xc4b5fd,
      transparent: true,
      opacity: 0.9,
    });

    // Exact clusters from start design.jpg
    const constellationPoints = [
      // Top Left Cluster
      { x: -1.75, y: 1.25, z: -0.4, scale: 0.85, color: 0x93c5fd, geo: miniGeo5 },
      { x: -1.55, y: 1.05, z: -0.2, scale: 0.7, color: 0xc4b5fd, geo: miniGeo4 },
      { x: -1.95, y: 0.85, z: -0.6, scale: 0.6, color: 0xa78bfa, geo: miniGeo5 },
      { x: -1.45, y: 0.65, z: -0.3, scale: 0.45, color: 0x60a5fa, geo: miniGeo4 },
      { x: -2.15, y: 0.45, z: -0.8, scale: 0.5, color: 0xe879f9, geo: miniGeo5 },

      // Top Right Cluster
      { x: 1.45, y: 1.35, z: -0.4, scale: 0.8, color: 0x93c5fd, geo: miniGeo5 },
      { x: 1.75, y: 1.15, z: -0.5, scale: 0.65, color: 0xc4b5fd, geo: miniGeo4 },
      { x: 1.25, y: 0.75, z: -0.2, scale: 0.5, color: 0x38bdf8, geo: miniGeo5 },
      { x: 1.95, y: 0.80, z: -0.7, scale: 0.7, color: 0xa855f7, geo: miniGeo4 },

      // Bottom Right Cluster
      { x: 1.65, y: -0.30, z: -0.4, scale: 0.6, color: 0x93c5fd, geo: miniGeo5 },
      { x: 1.85, y: -0.40, z: -0.6, scale: 0.55, color: 0xc084fc, geo: miniGeo4 },
      { x: 2.10, y: -0.15, z: -0.9, scale: 0.7, color: 0xe879f9, geo: miniGeo5 },
      { x: 1.95, y: -0.75, z: -0.5, scale: 0.6, color: 0x60a5fa, geo: miniGeo4 },
      { x: 2.15, y: -0.95, z: -0.7, scale: 0.45, color: 0x93c5fd, geo: miniGeo5 },

      // Bottom Left Cluster
      { x: -1.75, y: -0.35, z: -0.4, scale: 0.6, color: 0x93c5fd, geo: miniGeo5 },
      { x: -1.60, y: -0.50, z: -0.2, scale: 0.5, color: 0x38bdf8, geo: miniGeo4 },
      { x: -1.95, y: -0.60, z: -0.6, scale: 0.65, color: 0xa78bfa, geo: miniGeo5 },
      { x: -2.25, y: -0.85, z: -0.9, scale: 0.4, color: 0x93c5fd, geo: miniGeo4 },
    ];

    const constellationGroup = new THREE.Group();
    const miniItems: { mesh: THREE.Mesh; baseScale: number; speed: number; phase: number }[] = [];

    constellationPoints.forEach((pt, idx) => {
      const mat = miniStarMaterial.clone();
      mat.color = new THREE.Color(pt.color);
      const m = new THREE.Mesh(pt.geo, mat);
      m.position.set(pt.x, pt.y, pt.z);
      m.scale.setScalar(pt.scale);
      constellationGroup.add(m);
      miniItems.push({
        mesh: m,
        baseScale: pt.scale,
        speed: 1.6 + (idx % 3) * 0.4,
        phase: idx * 0.7,
      });
    });

    scene.add(constellationGroup);

    // 4. Balanced Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(1.5, 3.5, 4.5);
    scene.add(keyLight);

    const pinkFill = new THREE.PointLight(0xf472b6, 2.0, 8);
    pinkFill.position.set(-2, 2, 3);
    scene.add(pinkFill);

    const blueFill = new THREE.PointLight(0x38bdf8, 2.2, 8);
    blueFill.position.set(2, -2, 3);
    scene.add(blueFill);

    // 5. Interactive Touch / Mouse Physics
    let targetRotX = 0;
    let targetRotY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.4;
      targetRotX = -y * 0.3;
    };

    const handlePointerLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);

    // 6. Animation Loop (60 FPS)
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Gentle floating bobbing
      starMesh.position.y = Math.sin(t * 1.5) * 0.08;

      // Soft natural 3D rotational breathing + touch follow
      starMesh.rotation.y += (Math.sin(t * 0.8) * 0.22 + targetRotY - starMesh.rotation.y) * 0.06;
      starMesh.rotation.x += (Math.cos(t * 1.1) * 0.14 + targetRotX - starMesh.rotation.x) * 0.06;
      starMesh.rotation.z = -0.06 + Math.sin(t * 1.3) * 0.04;

      // Mini-star twinkling & drifting
      miniItems.forEach((item) => {
        const pulse = Math.sin(t * item.speed + item.phase);
        const s = item.baseScale * (1 + pulse * 0.2);
        item.mesh.scale.setScalar(s);
        (item.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.4;
      });

      constellationGroup.rotation.z = Math.sin(t * 0.3) * 0.02;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const newWidth = container.clientWidth || 360;
      camera.aspect = newWidth / sceneHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, sceneHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      cancelAnimationFrame(animId);

      geometry.dispose();
      starMaterial.dispose();
      gradientTexture.dispose();
      miniGeo5.dispose();
      miniGeo4.dispose();
      miniStarMaterial.dispose();
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [height]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl overflow-hidden mb-3 bg-[#0B101B] border border-white/10 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        borderRadius: '16px',
        overflow: 'hidden',
        marginBottom: '14px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'radial-gradient(circle at 50% 48%, #141B2D 0%, #090E17 100%)',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '0',
          right: '0',
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <div style={{ fontSize: '15.5px', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
          Telegram Premium
        </div>
        <div style={{ fontSize: '11.5px', color: '#94A3B8' }}>
          Go beyond limits with double quotas & exclusive badges
        </div>
      </div>
    </div>
  );
};
