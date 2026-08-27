import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { haptic } from '../haptics';

// ═════════════════════════════════════════════════════════════════════
// 1. MATHEMATICAL GEOMETRY BUILDER FOR TELEGRAM STAR
// ═════════════════════════════════════════════════════════════════════
function createTelegramStarShape(): THREE.Shape {
  const shape = new THREE.Shape();

  // Canonical 5-pointed Telegram Star with smooth rounded caps and signature paper-plane inner fold
  // 1. Top Apex (0, 1.35)
  shape.moveTo(0.0, 1.35);
  shape.bezierCurveTo(0.12, 1.35, 0.20, 1.25, 0.25, 1.05);

  // Valley between Top and Upper-Right
  shape.bezierCurveTo(0.32, 0.80, 0.40, 0.52, 0.50, 0.42);

  // 2. Upper-Right Arm
  shape.bezierCurveTo(0.72, 0.44, 1.15, 0.52, 1.34, 0.42);
  shape.bezierCurveTo(1.48, 0.32, 1.48, 0.10, 1.30, -0.05);

  // Valley between Upper-Right and Lower-Right
  shape.bezierCurveTo(1.10, -0.18, 0.70, -0.22, 0.55, -0.32);

  // 3. Lower-Right Arm
  shape.bezierCurveTo(0.65, -0.60, 0.85, -0.98, 0.78, -1.16);
  shape.bezierCurveTo(0.70, -1.32, 0.48, -1.30, 0.32, -1.08);

  // Valley Bottom Center Notch
  shape.bezierCurveTo(0.18, -0.85, 0.08, -0.62, 0.0, -0.62);
  shape.bezierCurveTo(-0.08, -0.62, -0.18, -0.85, -0.32, -1.08);

  // 4. Lower-Left Arm
  shape.bezierCurveTo(-0.48, -1.30, -0.70, -1.32, -0.78, -1.16);
  shape.bezierCurveTo(-0.85, -0.98, -0.65, -0.60, -0.55, -0.32);

  // ── Signature Telegram Plane-Fold Crease Notch ──
  // Cuts horizontally in towards center (0, 0.04)
  shape.bezierCurveTo(-0.45, -0.18, -0.25, -0.02, -0.04, 0.04);
  shape.bezierCurveTo(0.00, 0.06, -0.04, 0.10, -0.12, 0.12);
  shape.bezierCurveTo(-0.35, 0.16, -0.62, 0.18, -0.82, 0.22);

  // 5. Upper-Left Arm
  shape.bezierCurveTo(-1.08, 0.26, -1.38, 0.22, -1.44, 0.38);
  shape.bezierCurveTo(-1.48, 0.56, -1.25, 0.68, -0.98, 0.65);

  // Valley between Upper-Left and Top
  shape.bezierCurveTo(-0.70, 0.62, -0.45, 0.48, -0.38, 0.65);
  shape.bezierCurveTo(-0.30, 0.85, -0.22, 1.15, -0.20, 1.15);
  shape.bezierCurveTo(-0.16, 1.28, -0.10, 1.35, 0.0, 1.35);

  return shape;
}

// 4-pointed cross star geometry for background twinkling sparkles
function createSparkleGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outer = 0.22;
  const inner = 0.045;
  
  shape.moveTo(0, outer);
  shape.bezierCurveTo(inner * 0.4, inner, inner, inner * 0.4, outer, 0);
  shape.bezierCurveTo(inner * 0.4, -inner * 0.4, inner, -inner, 0, -outer);
  shape.bezierCurveTo(-inner * 0.4, -inner * 0.4, -inner, -inner * 0.4, -outer, 0);
  shape.bezierCurveTo(-inner * 0.4, inner * 0.4, -inner, inner, 0, outer);

  const geom = new THREE.ShapeGeometry(shape, 8);
  return geom;
}

interface TelegramPremium3DStarProps {
  className?: string;
  onExploreFeatures?: () => void;
}

export const TelegramPremium3DStar: React.FC<TelegramPremium3DStarProps> = ({
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // State for interactive UI controls & delight
  const [isInteracting, setIsInteracting] = useState(false);
  const [sparkleCount, setSparkleCount] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [activeFeatureTab, setActiveFeatureTab] = useState<number>(0);

  // Feature highlights to present below hero
  const premiumFeatures = [
    { title: '4 GB Uploads', desc: 'Send documents & media up to 4GB each', icon: '⚡' },
    { title: 'Fastest Speed', desc: 'No speed limits for media & file downloads', icon: '🚀' },
    { title: 'Star Badge', desc: 'Exclusive star next to your name', icon: '🌟' },
    { title: 'Voice-to-Text', desc: 'Instant transcriptions of voice messages', icon: '💬' },
    { title: 'Profile Colors', desc: 'Custom accent colors & wallpaper for your profile', icon: '🎨' },
  ];

  // 3D Engine references for animation loop
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    starMesh: THREE.Mesh | null;
    sparklesGroup: THREE.Group | null;
    burstParticles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; maxLife: number }[];
    pointLight: THREE.PointLight | null;
    targetRotX: number;
    targetRotY: number;
    currentRotX: number;
    currentRotY: number;
    targetScale: number;
    currentScale: number;
    isDragging: boolean;
    prevPointerX: number;
    prevPointerY: number;
    velX: number;
    velY: number;
    animFrameId: number;
    time: number;
    isVisible: boolean;
  }>({
    renderer: null,
    scene: null,
    camera: null,
    starMesh: null,
    sparklesGroup: null,
    burstParticles: [],
    pointLight: null,
    targetRotX: 0.36,
    targetRotY: -0.18,
    currentRotX: 0.36,
    currentRotY: -0.18,
    targetScale: 1.0,
    currentScale: 1.0,
    isDragging: false,
    prevPointerX: 0,
    prevPointerY: 0,
    velX: 0,
    velY: 0,
    animFrameId: 0,
    time: 0,
    isVisible: true,
  });

  // Trigger bursting sparkles on tap/click
  const triggerBurst = useCallback(() => {
    haptic.tap();
    setSparkleCount((prev) => prev + 1);

    const engine = engineRef.current;
    if (!engine.scene) return;

    // Scale pulse
    engine.targetScale = 1.18;
    setTimeout(() => {
      engine.targetScale = 1.0;
    }, 180);

    // Create 16 burst sparkle particles
    const sparkleGeom = createSparkleGeometry();
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.78 + Math.random() * 0.18, 0.95, 0.75 + Math.random() * 0.2),
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const pMesh = new THREE.Mesh(sparkleGeom, mat);
      pMesh.position.set(
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.4 + 0.2
      );
      const angle = (i / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 0.045 + Math.random() * 0.055;
      const scale = 0.5 + Math.random() * 0.6;
      pMesh.scale.set(scale, scale, scale);

      engine.scene.add(pMesh);
      engine.burstParticles.push({
        mesh: pMesh,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (Math.random() - 0.5) * 0.03,
        life: 1.0,
        maxLife: 1.0,
      });
    }
  }, []);

  // WebGL Lifecycle & Rendering Initializer
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 320;
    const height = 230;

    // ── SCENE & CAMERA ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.2);

    // ── RENDERER ──
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      // Graceful fallback if WebGL fails
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // ── 3D STAR MESH CONSTRUCTION ──
    const starShape = createTelegramStarShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.38,
      bevelEnabled: true,
      bevelSegments: 16,
      steps: 2,
      bevelSize: 0.14,
      bevelThickness: 0.14,
    };
    const starGeometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    starGeometry.center();
    starGeometry.computeVertexNormals();

    // ── LUXURY PBR GRADIENT MATERIAL ──
    // Custom Shader Material that blends Telegram's signature Purple -> Blue vertical gradient
    // with metallic sheen, specular reflections, and Fresnel rim glow
    const starMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x8B5CF6,
      metalness: 0.22,
      roughness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      reflectivity: 0.85,
      iridescence: 0.35,
      iridescenceIOR: 1.35,
    });

    // Custom shader modification for spatial gradient + rim glow
    starMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        varying vec3 vWorldPosition;
        varying vec3 vModelPosition;
        varying vec3 vNormalVec;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vModelPosition = position;
        vNormalVec = normal;
        `
      );

      shader.fragmentShader = `
        varying vec3 vModelPosition;
        varying vec3 vNormalVec;
        ${shader.fragmentShader}
      `.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>
        // Smooth Telegram Violet to Azure Blue Gradient
        float gradT = clamp((vModelPosition.y + 1.25) / 2.5, 0.0, 1.0);
        
        // Colors:
        // Top: Rich Violet / Magenta (#C04CFD -> #9333EA)
        // Bottom: Electric Azure / Cyan (#0284C7 -> #38BDF8)
        vec3 colBottom = vec3(0.06, 0.58, 0.96);
        vec3 colMid = vec3(0.48, 0.22, 0.94);
        vec3 colTop = vec3(0.78, 0.32, 0.98);
        
        vec3 gradCol = mix(colBottom, colMid, smoothstep(0.0, 0.52, gradT));
        gradCol = mix(gradCol, colTop, smoothstep(0.48, 1.0, gradT));
        
        // Fresnel rim light for edge definition
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(vNormalVec, vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
        vec3 rimGlow = mix(vec3(0.3, 0.8, 1.0), vec3(0.9, 0.4, 1.0), gradT) * fresnel * 0.45;
        
        gl_FragColor.rgb = gl_FragColor.rgb * gradCol * 1.55 + rimGlow;
        `
      );
    };

    const starMesh = new THREE.Mesh(starGeometry, starMaterial);
    starMesh.scale.set(0.95, 0.95, 0.95);
    scene.add(starMesh);

    // ── LIGHTING SETUP ──
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.85);
    scene.add(ambientLight);

    // Key Light (Top-Left Magenta)
    const keyLight = new THREE.DirectionalLight(0xe879f9, 2.2);
    keyLight.position.set(-3, 4, 4);
    scene.add(keyLight);

    // Fill Light (Bottom-Right Cyan)
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
    fillLight.position.set(3, -3, 3);
    scene.add(fillLight);

    // Top Rim Light
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.5);
    rimLight.position.set(0, 5, -2);
    scene.add(rimLight);

    // Interactive Point Light that follows pointer
    const dynamicPointLight = new THREE.PointLight(0xffffff, 2.5, 8);
    dynamicPointLight.position.set(0, 0, 3.2);
    scene.add(dynamicPointLight);

    // ── 3D STAR CONSTELLATION (Twinkling Cross-Stars) ──
    const sparklesGroup = new THREE.Group();
    const sparkleGeom = createSparkleGeometry();
    const sparkleCount = 36;
    const sparkleItems: { mesh: THREE.Mesh; phase: number; speed: number; baseScale: number }[] = [];

    for (let i = 0; i < sparkleCount; i++) {
      const isTop = Math.random() > 0.4;
      const color = isTop ? 0xc084fc : 0x38bdf8;
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.3 ? color : 0xffffff,
        transparent: true,
        opacity: 0.6 + Math.random() * 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(sparkleGeom, mat);
      // Scatter in 3D around the star
      const radius = 1.3 + Math.random() * 1.8;
      const theta = Math.random() * Math.PI * 2;
      const x = Math.cos(theta) * radius * 1.25;
      const y = Math.sin(theta) * radius * 0.95;
      const z = (Math.random() - 0.5) * 2.2;

      mesh.position.set(x, y, z);
      const baseScale = 0.4 + Math.random() * 0.65;
      mesh.scale.set(baseScale, baseScale, baseScale);
      mesh.rotation.z = Math.random() * Math.PI;

      sparklesGroup.add(mesh);
      sparkleItems.push({
        mesh,
        phase: Math.random() * Math.PI * 2,
        speed: 1.5 + Math.random() * 2.5,
        baseScale,
      });
    }
    scene.add(sparklesGroup);

    // Save engine refs
    const engine = engineRef.current;
    engine.renderer = renderer;
    engine.scene = scene;
    engine.camera = camera;
    engine.starMesh = starMesh;
    engine.sparklesGroup = sparklesGroup;
    engine.pointLight = dynamicPointLight;

    // ── RENDER & PHYSICS LOOP ──
    let lastTime = performance.now();

    const animate = () => {
      engine.animFrameId = requestAnimationFrame(animate);

      if (!engine.isVisible) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      engine.time += dt;

      // ── Physics: Inertia & Drag Spring Damping ──
      if (!engine.isDragging) {
        if (autoRotate) {
          // Organic zero-gravity idle float & rotation
          const hoverY = Math.sin(engine.time * 1.8) * 0.08;
          const wobbleZ = Math.sin(engine.time * 1.2) * 0.04;
          starMesh.position.y = hoverY;
          starMesh.rotation.z = wobbleZ;

          // Gentle continuous rotation
          engine.targetRotY += 0.008;
        }

        // Apply friction to drag velocity
        engine.velX *= 0.92;
        engine.velY *= 0.92;
        engine.targetRotY += engine.velX;
        engine.targetRotX += engine.velY;

        // Clamp Pitch so it doesn't flip upside down
        engine.targetRotX = Math.max(-0.65, Math.min(0.65, engine.targetRotX));
      }

      // Smooth Lerp to target rotation
      engine.currentRotX += (engine.targetRotX - engine.currentRotX) * 0.12;
      engine.currentRotY += (engine.targetRotY - engine.currentRotY) * 0.12;

      starMesh.rotation.x = engine.currentRotX;
      starMesh.rotation.y = engine.currentRotY;

      // Smooth Scale lerp
      engine.currentScale += (engine.targetScale - engine.currentScale) * 0.15;
      starMesh.scale.set(
        0.95 * engine.currentScale,
        0.95 * engine.currentScale,
        0.95 * engine.currentScale
      );

      // Sparkles constellation subtle parallax and twinkle
      sparklesGroup.rotation.y = engine.currentRotY * 0.25;
      sparklesGroup.rotation.x = engine.currentRotX * 0.25;

      sparkleItems.forEach((sp) => {
        const pulse = Math.sin(engine.time * sp.speed + sp.phase);
        const s = sp.baseScale * (0.75 + pulse * 0.35);
        sp.mesh.scale.set(s, s, s);
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.45;
        sp.mesh.rotation.z += 0.005;
      });

      // Update Tap Burst Particles
      for (let i = engine.burstParticles.length - 1; i >= 0; i--) {
        const p = engine.burstParticles[i];
        p.life -= dt * 1.8;
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.mesh.rotation.z += 0.08;

        const pScale = (p.life / p.maxLife);
        p.mesh.scale.set(pScale * 0.6, pScale * 0.6, pScale * 0.6);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, pScale);

        if (p.life <= 0) {
          scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose();
          engine.burstParticles.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // ── RESIZE OBSERVER ──
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0) {
          camera.aspect = newWidth / height;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, height);
        }
      }
    });
    resizeObserver.observe(container);

    // ── INTERSECTION OBSERVER (0% GPU when hidden) ──
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        engine.isVisible = entry.isIntersecting;
      }
    });
    intersectionObserver.observe(container);

    // ── CLEANUP ON UNMOUNT ──
    return () => {
      cancelAnimationFrame(engine.animFrameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();

      // Dispose all Three.js resources
      starGeometry.dispose();
      starMaterial.dispose();
      sparkleGeom.dispose();
      engine.burstParticles.forEach((p) => {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      });
      sparkleItems.forEach((sp) => {
        (sp.mesh.material as THREE.Material).dispose();
      });
      renderer.dispose();
    };
  }, [autoRotate]);

  // ── INTERACTIVE TOUCH / POINTER HANDLERS ──
  const handlePointerDown = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    engine.isDragging = true;
    engine.prevPointerX = e.clientX;
    engine.prevPointerY = e.clientY;
    engine.velX = 0;
    engine.velY = 0;
    setIsInteracting(true);
    setAutoRotate(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const normX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const normY = -((e.clientY - rect.top) / rect.height - 0.5) * 2;

    // Move interactive light
    if (engine.pointLight) {
      engine.pointLight.position.set(normX * 2.5, normY * 2.0, 3.0);
    }

    if (engine.isDragging) {
      const deltaX = e.clientX - engine.prevPointerX;
      const deltaY = e.clientY - engine.prevPointerY;
      engine.prevPointerX = e.clientX;
      engine.prevPointerY = e.clientY;

      engine.velX = deltaX * 0.012;
      engine.velY = deltaY * 0.012;

      engine.targetRotY += engine.velX;
      engine.targetRotX += engine.velY;
    } else {
      // Subtle tilt follow when hovering
      engine.targetRotX = 0.18 - normY * 0.22;
      engine.targetRotY = -0.22 + normX * 0.35;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    engine.isDragging = false;
    setIsInteracting(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const resetHeroAngle = (e: React.MouseEvent) => {
    e.stopPropagation();
    haptic.tap();
    const engine = engineRef.current;
    engine.targetRotX = 0.18;
    engine.targetRotY = -0.22;
    engine.velX = 0;
    engine.velY = 0;
    setAutoRotate(true);
  };

  return (
    <div
      ref={containerRef}
      className={`telegram-premium-3d-card ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: '24px',
        padding: '16px 14px 18px 14px',
        marginBottom: '16px',
        background: 'radial-gradient(ellipse at 50% 28%, #141c2e 0%, #080c16 85%)',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        boxShadow: '0 16px 40px -10px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      {/* ── Dynamic Purple/Cyan Ambient Nebula Glow ── */}
      <div
        style={{
          position: 'absolute',
          top: '22%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '210px',
          height: '170px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.42) 0%, rgba(56, 189, 248, 0.22) 55%, transparent 80%)',
          filter: 'blur(32px)',
          pointerEvents: 'none',
          zIndex: 1,
          animation: 'nebulaPulse 5s ease-in-out infinite alternate',
        }}
      />

      {/* ── 3D Interactive WebGL Hero Canvas ── */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={triggerBurst}
        style={{
          position: 'relative',
          width: '100%',
          height: '230px',
          cursor: isInteracting ? 'grabbing' : 'grab',
          touchAction: 'none',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="Drag to orbit 3D star • Tap to sparkle"
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            outline: 'none',
          }}
        />

        {/* Floating Quick Action Pill */}
        <div
          style={{
            position: 'absolute',
            bottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 4,
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={triggerBurst}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(255, 255, 255, 0.08)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#E0F2FE',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <span>✨ Tap to Sparkle</span>
            {sparkleCount > 0 && (
              <span
                style={{
                  background: 'linear-gradient(135deg, #A855F7, #38BDF8)',
                  borderRadius: '10px',
                  padding: '1px 5px',
                  fontSize: '9.5px',
                  color: '#fff',
                  fontWeight: 800,
                }}
              >
                +{sparkleCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={resetHeroAngle}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '20px',
              background: 'rgba(255, 255, 255, 0.06)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94A3B8',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span>🔄 Reset</span>
          </button>
        </div>
      </div>

      {/* ── Authentic Typography Section ── */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '6px',
          width: '100%',
          zIndex: 3,
          position: 'relative',
        }}
      >
        <div
          style={{
            fontSize: '20px',
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '-0.3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <span>Telegram Premium</span>
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #A855F7 0%, #38BDF8 100%)',
              color: '#FFFFFF',
              letterSpacing: '0.6px',
              boxShadow: '0 2px 10px rgba(168, 85, 247, 0.45)',
            }}
          >
            PREMIUM
          </span>
        </div>

        <p
          style={{
            fontSize: '13px',
            color: '#94A3B8',
            marginTop: '5px',
            marginBottom: '12px',
            fontWeight: 400,
            lineHeight: 1.45,
            padding: '0 8px',
          }}
        >
          Go <strong style={{ color: '#FFFFFF', fontWeight: 600 }}>beyond the limits</strong> and unlock dozens of exclusive features by subscribing to <strong style={{ color: '#38BDF8', fontWeight: 600 }}>Telegram Premium</strong>.
        </p>

        {/* ── Interactive Feature Chips ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            marginTop: '8px',
          }}
        >
          {premiumFeatures.map((feat, idx) => {
            const isActive = activeFeatureTab === idx;
            return (
              <button
                key={feat.title}
                type="button"
                onClick={() => {
                  setActiveFeatureTab(idx);
                  haptic.select();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 9px',
                  borderRadius: '12px',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(56, 189, 248, 0.25) 100%)'
                    : 'rgba(255, 255, 255, 0.04)',
                  border: isActive
                    ? '1px solid rgba(168, 85, 247, 0.5)'
                    : '1px solid rgba(255, 255, 255, 0.06)',
                  color: isActive ? '#FFFFFF' : '#94A3B8',
                  fontSize: '11.5px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
              >
                <span>{feat.icon}</span>
                <span>{feat.title}</span>
              </button>
            );
          })}
        </div>

        {/* Active Feature Description Box */}
        <div
          style={{
            marginTop: '10px',
            padding: '8px 12px',
            borderRadius: '12px',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '12px',
            color: '#CBD5E1',
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '14px' }}>{premiumFeatures[activeFeatureTab].icon}</span>
          <span>{premiumFeatures[activeFeatureTab].desc}</span>
        </div>
      </div>

      {/* Embedded CSS Keyframes */}
      <style>{`
        @keyframes nebulaPulse {
          0% {
            opacity: 0.4;
            transform: translate(-50%, -50%) scale(0.92);
          }
          100% {
            opacity: 0.8;
            transform: translate(-50%, -50%) scale(1.15);
          }
        }
      `}</style>
    </div>
  );
};

