import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const TelegramPremium3DStar: React.FC<{ className?: string; height?: number }> = ({
  className,
  height = 195,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 360;
    const sceneHeight = height;

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / sceneHeight, 0.1, 100);
    camera.position.set(0, 0, 5.5);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, sceneHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 1. Exact Telegram Premium Star 2D Shape with Folded Crease & Puffy Rounded Curves
    const shape = new THREE.Shape();

    // Trace Telegram Star perimeter
    // Top point
    shape.moveTo(-0.12, 1.48);
    shape.quadraticCurveTo(0, 1.68, 0.16, 1.48);

    // Top-right slope to valley
    shape.quadraticCurveTo(0.38, 0.95, 0.52, 0.58);
    shape.quadraticCurveTo(0.56, 0.46, 0.68, 0.44);

    // Right arm
    shape.quadraticCurveTo(1.25, 0.40, 1.58, 0.35);
    shape.quadraticCurveTo(1.78, 0.22, 1.56, 0.05);

    // Right arm to bottom-right valley
    shape.quadraticCurveTo(1.08, -0.22, 0.72, -0.45);
    shape.quadraticCurveTo(0.64, -0.52, 0.68, -0.66);

    // Bottom-right leg
    shape.quadraticCurveTo(0.82, -1.15, 0.94, -1.48);
    shape.quadraticCurveTo(0.85, -1.72, 0.62, -1.55);

    // Bottom-right leg to bottom valley
    shape.quadraticCurveTo(0.32, -1.22, 0.0, -0.88);
    shape.quadraticCurveTo(-0.12, -0.92, -0.25, -1.12);

    // Bottom-left leg (distinctive rounded swooping Telegram curve)
    shape.quadraticCurveTo(-0.55, -1.45, -0.82, -1.58);
    shape.quadraticCurveTo(-1.08, -1.48, -0.95, -1.18);
    shape.quadraticCurveTo(-0.78, -0.72, -0.72, -0.42);

    // The iconic Telegram crease folding inwards into center
    shape.quadraticCurveTo(-0.45, -0.20, -0.05, -0.05);
    shape.quadraticCurveTo(-0.02, 0.02, -0.15, 0.06);

    // Extending out to left arm
    shape.quadraticCurveTo(-0.85, 0.18, -1.45, 0.32);
    shape.quadraticCurveTo(-1.72, 0.48, -1.42, 0.65);

    // Left arm back to top valley
    shape.quadraticCurveTo(-0.95, 0.82, -0.58, 0.62);
    shape.quadraticCurveTo(-0.46, 0.58, -0.38, 0.78);
    shape.quadraticCurveTo(-0.25, 1.15, -0.12, 1.48);

    // Extrude with soft pillowed bevels
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.32,
      bevelEnabled: true,
      bevelSegments: 10,
      steps: 3,
      bevelSize: 0.14,
      bevelThickness: 0.14,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();

    // 2. Exact Pink-to-SkyBlue Telegram Gradient Canvas Texture
    const gradientCanvas = document.createElement('canvas');
    gradientCanvas.width = 512;
    gradientCanvas.height = 512;
    const ctx2d = gradientCanvas.getContext('2d')!;

    // Soft angled vertical gradient matching start design.jpg
    const grad = ctx2d.createLinearGradient(120, 0, 380, 512);
    grad.addColorStop(0.0, '#F472B6'); // Top vibrant orchid pink
    grad.addColorStop(0.25, '#E879F9'); // Upper purple/magenta
    grad.addColorStop(0.55, '#A855F7'); // Core telegram purple
    grad.addColorStop(0.82, '#60A5FA'); // Azure blue
    grad.addColorStop(1.0, '#38BDF8'); // Cyan sky blue at bottom

    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, 512, 512);

    const gradientTexture = new THREE.CanvasTexture(gradientCanvas);
    gradientTexture.wrapS = THREE.ClampToEdgeWrapping;
    gradientTexture.wrapT = THREE.ClampToEdgeWrapping;

    const starMaterial = new THREE.MeshPhysicalMaterial({
      map: gradientTexture,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      reflectivity: 0.8,
      emissive: new THREE.Color('#3B0764'),
      emissiveIntensity: 0.22,
    });

    const starMesh = new THREE.Mesh(geometry, starMaterial);
    scene.add(starMesh);

    // 3. Mini-Star 3D Background Constellation (matching exact clusters in start design.jpg)
    const miniStarShape = new THREE.Shape();
    const miniPoints = 5;
    const miniOuter = 0.12;
    const miniInner = 0.055;
    for (let i = 0; i < miniPoints * 2; i++) {
      const r = i % 2 === 0 ? miniOuter : miniInner;
      const a = (i * Math.PI) / miniPoints - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) miniStarShape.moveTo(px, py);
      else miniStarShape.lineTo(px, py);
    }
    miniStarShape.closePath();

    const miniGeometry = new THREE.ExtrudeGeometry(miniStarShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.02,
      bevelThickness: 0.02,
    });
    miniGeometry.center();

    const miniStarMaterial = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.85,
    });

    // Exact Constellation Offsets from start design.jpg
    const constellationData = [
      // Top Left Cluster
      { x: -1.95, y: 1.35, z: -0.6, scale: 0.9, rot: 0.2, color: 0xc4b5fd },
      { x: -1.75, y: 1.15, z: -0.3, scale: 0.7, rot: -0.4, color: 0x93c5fd },
      { x: -2.15, y: 0.95, z: -0.8, scale: 0.6, rot: 0.6, color: 0x60a5fa },
      { x: -1.60, y: 0.70, z: -0.4, scale: 0.45, rot: 0.1, color: 0xe879f9 },
      { x: -2.40, y: 0.50, z: -1.0, scale: 0.5, rot: -0.3, color: 0xa78bfa },

      // Top Right Cluster
      { x: 1.55, y: 1.45, z: -0.5, scale: 0.85, rot: -0.2, color: 0x93c5fd },
      { x: 1.85, y: 1.25, z: -0.7, scale: 0.65, rot: 0.5, color: 0xc4b5fd },
      { x: 1.35, y: 0.85, z: -0.3, scale: 0.5, rot: -0.6, color: 0x38bdf8 },
      { x: 2.10, y: 0.90, z: -0.9, scale: 0.7, rot: 0.3, color: 0xa855f7 },

      // Bottom Right Cluster
      { x: 1.80, y: -0.35, z: -0.5, scale: 0.6, rot: 0.4, color: 0x93c5fd },
      { x: 1.95, y: -0.45, z: -0.7, scale: 0.55, rot: -0.2, color: 0xc084fc },
      { x: 2.30, y: -0.15, z: -1.1, scale: 0.75, rot: 0.1, color: 0xe879f9 },
      { x: 2.15, y: -0.85, z: -0.6, scale: 0.65, rot: -0.5, color: 0x60a5fa },
      { x: 2.35, y: -1.10, z: -0.8, scale: 0.5, rot: 0.2, color: 0x93c5fd },

      // Bottom Left Cluster
      { x: -1.90, y: -0.40, z: -0.5, scale: 0.65, rot: -0.3, color: 0x93c5fd },
      { x: -1.75, y: -0.55, z: -0.3, scale: 0.5, rot: 0.5, color: 0x38bdf8 },
      { x: -2.15, y: -0.65, z: -0.8, scale: 0.7, rot: -0.1, color: 0xa78bfa },
      { x: -2.45, y: -0.95, z: -1.2, scale: 0.4, rot: 0.7, color: 0x93c5fd },
    ];

    const constellationGroup = new THREE.Group();
    const miniStarMeshes: { mesh: THREE.Mesh; baseScale: number; speed: number; phase: number }[] = [];

    constellationData.forEach((c, idx) => {
      const mat = miniStarMaterial.clone();
      mat.color = new THREE.Color(c.color);
      const m = new THREE.Mesh(miniGeometry, mat);
      m.position.set(c.x, c.y, c.z);
      m.rotation.z = c.rot;
      m.scale.setScalar(c.scale);
      constellationGroup.add(m);
      miniStarMeshes.push({
        mesh: m,
        baseScale: c.scale,
        speed: 1.5 + (idx % 4) * 0.5,
        phase: idx * 0.8,
      });
    });

    scene.add(constellationGroup);

    // 4. Lighting: Soft ambient + crisp top keylight
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2, 4, 5);
    scene.add(dirLight);

    const backLight = new THREE.PointLight(0xa855f7, 2.5, 10);
    backLight.position.set(0, 0, -2);
    scene.add(backLight);

    // 5. Interactive Touch / Mouse Tilt
    let targetRotX = 0;
    let targetRotY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetRotY = x * 0.45;
      targetRotX = -y * 0.35;
    };

    const handlePointerLeave = () => {
      targetRotX = 0;
      targetRotY = 0;
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);

    // 6. Animation Loop
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Floating gentle bobbing
      starMesh.position.y = Math.sin(t * 1.6) * 0.08;

      // Smooth subtle 3D tilt
      starMesh.rotation.y += (Math.sin(t * 0.9) * 0.25 + targetRotY - starMesh.rotation.y) * 0.07;
      starMesh.rotation.x += (Math.cos(t * 1.2) * 0.15 + targetRotX - starMesh.rotation.x) * 0.07;
      starMesh.rotation.z = Math.sin(t * 1.4) * 0.04;

      // Mini-star twinkling & drifting
      miniStarMeshes.forEach((item) => {
        const pulse = Math.sin(t * item.speed + item.phase);
        const s = item.baseScale * (1 + pulse * 0.22);
        item.mesh.scale.setScalar(s);
        (item.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 + pulse * 0.35;
      });

      constellationGroup.rotation.z = Math.sin(t * 0.4) * 0.03;

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
      miniGeometry.dispose();
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
      className={`relative w-full rounded-2xl overflow-hidden mb-3 bg-[#0A0F1A] border border-white/10 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: `${height}px`,
        borderRadius: '16px',
        overflow: 'hidden',
        marginBottom: '14px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'radial-gradient(circle at 50% 45%, #131B2E 0%, #080D17 100%)',
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
