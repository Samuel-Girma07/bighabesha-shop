import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { haptic } from '../haptics';

// ═════════════════════════════════════════════════════════════════════
// 1. MATHEMATICAL 3D STAR GEOMETRY (CRISP & SHARP AS IN REFERENCE)
// ═════════════════════════════════════════════════════════════════════
function createTelegramStarShape(): THREE.Shape {
  const shape = new THREE.Shape();

  // Chunky, bold 5-point Telegram Star with crisp planar edges and exact proportions from stars 3d.jpg
  
  // 1. Top Apex (centered at 90°)
  shape.moveTo(-0.16, 1.35);
  shape.quadraticCurveTo(0.0, 1.45, 0.16, 1.35);
  
  // Top-Right Valley
  shape.lineTo(0.36, 0.46);
  
  // 2. Upper-Right Arm (18°)
  shape.lineTo(1.30, 0.52);
  shape.quadraticCurveTo(1.44, 0.44, 1.36, 0.28);
  
  // Right-Bottom Valley
  shape.lineTo(0.54, -0.20);
  
  // 3. Lower-Right Arm (-54°)
  shape.lineTo(0.88, -1.12);
  shape.quadraticCurveTo(0.80, -1.25, 0.64, -1.18);
  
  // Bottom-Center Notch (-90°)
  shape.lineTo(0.0, -0.56);
  
  // 4. Lower-Left Arm (-126°)
  shape.lineTo(-0.64, -1.18);
  shape.quadraticCurveTo(-0.80, -1.25, -0.88, -1.12);
  
  // Left-Bottom Valley into horizontal crease
  shape.lineTo(-0.52, -0.16);
  
  // ── Signature Horizontal Paper-Plane Crease Slit ──
  // Reaches inward horizontally towards center
  shape.lineTo(-0.02, 0.06);
  // Slit upper edge extending back to left arm
  shape.lineTo(-0.54, 0.14);
  
  // 5. Upper-Left Arm (162°)
  shape.lineTo(-1.32, 0.26);
  shape.quadraticCurveTo(-1.44, 0.40, -1.28, 0.50);
  
  // Top-Left Valley
  shape.lineTo(-0.36, 0.46);
  
  // Back to Top Apex
  shape.lineTo(-0.16, 1.35);

  return shape;
}

// 4-pointed cross star geometry for background twinkling sparkles
function createSparkleGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outer = 0.20;
  const inner = 0.035;
  
  shape.moveTo(0, outer);
  shape.bezierCurveTo(inner * 0.4, inner, inner, inner * 0.4, outer, 0);
  shape.bezierCurveTo(inner * 0.4, -inner * 0.4, inner, -inner, 0, -outer);
  shape.bezierCurveTo(-inner * 0.4, -inner * 0.4, -inner, -inner * 0.4, -outer, 0);
  shape.bezierCurveTo(-inner * 0.4, inner * 0.4, -inner, inner, 0, outer);

  return new THREE.ShapeGeometry(shape, 6);
}

interface TelegramPremium3DStarProps {
  className?: string;
}

export const TelegramPremium3DStar: React.FC<TelegramPremium3DStarProps> = ({
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 3D Engine state refs
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
    targetRotX: 0.32,
    targetRotY: -0.16,
    currentRotX: 0.32,
    currentRotY: -0.16,
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

  // Tap reaction: subtle bounce & stardust burst with Telegram haptic feedback
  const handleStarTap = useCallback(() => {
    haptic.tap();

    const engine = engineRef.current;
    if (!engine.scene) return;

    // Subtle scale bounce
    engine.targetScale = 1.10;
    setTimeout(() => {
      engine.targetScale = 1.0;
    }, 160);

    // Stardust burst particles
    const sparkleGeom = createSparkleGeometry();
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.76 + Math.random() * 0.18, 0.95, 0.8),
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const pMesh = new THREE.Mesh(sparkleGeom, mat);
      pMesh.position.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.3 + 0.2
      );
      const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 0.04 + Math.random() * 0.045;
      const scale = 0.45 + Math.random() * 0.5;
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

  // WebGL 3D Setup & Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 320;
    const height = 210;

    // ── SCENE & CAMERA ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.0);

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
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    // ── 3D STAR MESH WITH CRISP, SHARP BEVELS ──
    const starShape = createTelegramStarShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.38,
      bevelEnabled: true,
      bevelSegments: 4,     // Crisp, sharp beveled edge (not puffy/rounded)
      steps: 1,
      bevelSize: 0.035,     // Tight micro-bevel chamfer matching reference
      bevelThickness: 0.035,
    };
    const starGeometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    starGeometry.center();
    starGeometry.computeVertexNormals();

    // ── PBR GRADIENT MATERIAL ──
    const starMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x8B5CF6,
      metalness: 0.18,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 0.9,
      iridescence: 0.25,
      iridescenceIOR: 1.3,
    });

    // Custom shader modification for vertical spatial gradient + Fresnel rim glow
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
        
        // Exact colors from reference:
        // Top: Rich Violet / Magenta (#C04CFD -> #9333EA)
        // Bottom: Electric Azure / Cyan (#0284C7 -> #38BDF8)
        vec3 colBottom = vec3(0.12, 0.62, 0.98);
        vec3 colMid = vec3(0.55, 0.28, 0.95);
        vec3 colTop = vec3(0.78, 0.38, 0.98);
        
        vec3 gradCol = mix(colBottom, colMid, smoothstep(0.0, 0.52, gradT));
        gradCol = mix(gradCol, colTop, smoothstep(0.48, 1.0, gradT));
        
        // Crisp Fresnel rim glow
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(vNormalVec, vec3(0.0, 0.0, 1.0)), 0.0), 2.5);
        vec3 rimGlow = mix(vec3(0.2, 0.75, 1.0), vec3(0.85, 0.4, 1.0), gradT) * fresnel * 0.48;
        
        gl_FragColor.rgb = gl_FragColor.rgb * gradCol * 1.55 + rimGlow;
        `
      );
    };

    const starMesh = new THREE.Mesh(starGeometry, starMaterial);
    starMesh.scale.set(0.92, 0.92, 0.92);
    scene.add(starMesh);

    // ── LIGHTING SETUP ──
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.9);
    scene.add(ambientLight);

    // Key Light (Top-Left Magenta)
    const keyLight = new THREE.DirectionalLight(0xe879f9, 2.4);
    keyLight.position.set(-3, 4, 4);
    scene.add(keyLight);

    // Fill Light (Bottom-Right Cyan)
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    fillLight.position.set(3, -3, 3);
    scene.add(fillLight);

    // Top Rim Light
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.6);
    rimLight.position.set(0, 5, -2);
    scene.add(rimLight);

    // Dynamic Pointer Light
    const dynamicPointLight = new THREE.PointLight(0xffffff, 2.2, 8);
    dynamicPointLight.position.set(0, 0, 3.2);
    scene.add(dynamicPointLight);

    // ── 3D STAR CONSTELLATION (Twinkling Cross-Stars) ──
    const sparklesGroup = new THREE.Group();
    const sparkleGeom = createSparkleGeometry();
    const sparkleCount = 38;
    const sparkleItems: { mesh: THREE.Mesh; phase: number; speed: number; baseScale: number }[] = [];

    for (let i = 0; i < sparkleCount; i++) {
      const isTop = Math.random() > 0.4;
      const color = isTop ? 0xc084fc : 0x38bdf8;
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.35 ? color : 0xffffff,
        transparent: true,
        opacity: 0.6 + Math.random() * 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(sparkleGeom, mat);
      const radius = 1.2 + Math.random() * 1.9;
      const theta = Math.random() * Math.PI * 2;
      const x = Math.cos(theta) * radius * 1.3;
      const y = Math.sin(theta) * radius * 0.95;
      const z = (Math.random() - 0.5) * 2.0;

      mesh.position.set(x, y, z);
      const baseScale = 0.35 + Math.random() * 0.6;
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

      // ── Zero-G Idle Hover & Friction Physics ──
      if (!engine.isDragging) {
        // Organic zero-gravity idle float & rotation
        const hoverY = Math.sin(engine.time * 1.8) * 0.06;
        const wobbleZ = Math.sin(engine.time * 1.2) * 0.03;
        starMesh.position.y = hoverY;
        starMesh.rotation.z = wobbleZ;

        // Apply friction to drag velocity
        engine.velX *= 0.92;
        engine.velY *= 0.92;
        engine.targetRotY += engine.velX;
        engine.targetRotX += engine.velY;

        // Clamp Pitch
        engine.targetRotX = Math.max(-0.65, Math.min(0.65, engine.targetRotX));
      }

      // Smooth Lerp to target rotation
      engine.currentRotX += (engine.targetRotX - engine.currentRotX) * 0.12;
      engine.currentRotY += (engine.targetRotY - engine.currentRotY) * 0.12;

      starMesh.rotation.x = engine.currentRotX;
      starMesh.rotation.y = engine.currentRotY;

      // Smooth Scale lerp
      engine.currentScale += (engine.targetScale - engine.currentScale) * 0.16;
      starMesh.scale.set(
        0.92 * engine.currentScale,
        0.92 * engine.currentScale,
        0.92 * engine.currentScale
      );

      // Sparkles constellation parallax and twinkle
      sparklesGroup.rotation.y = engine.currentRotY * 0.25;
      sparklesGroup.rotation.x = engine.currentRotX * 0.25;

      sparkleItems.forEach((sp) => {
        const pulse = Math.sin(engine.time * sp.speed + sp.phase);
        const s = sp.baseScale * (0.75 + pulse * 0.35);
        sp.mesh.scale.set(s, s, s);
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.45;
      });

      // Update Burst Particles
      for (let i = engine.burstParticles.length - 1; i >= 0; i--) {
        const p = engine.burstParticles[i];
        p.life -= dt * 1.8;
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.mesh.rotation.z += 0.08;

        const pScale = (p.life / p.maxLife);
        p.mesh.scale.set(pScale * 0.5, pScale * 0.5, pScale * 0.5);
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

    // ── INTERSECTION OBSERVER ──
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
  }, []);

  // ── INTERACTIVE TOUCH / POINTER HANDLERS ──
  const handlePointerDown = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    engine.isDragging = true;
    engine.prevPointerX = e.clientX;
    engine.prevPointerY = e.clientY;
    engine.velX = 0;
    engine.velY = 0;
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
      engine.targetRotX = 0.32 - normY * 0.20;
      engine.targetRotY = -0.16 + normX * 0.30;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    engine.isDragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  return (
    <div
      ref={containerRef}
      className={`telegram-premium-3d-showcase ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 0 20px 0',
        userSelect: 'none',
      }}
    >
      {/* ── Soft Atmospheric Radial Glow ── */}
      <div
        style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '200px',
          height: '160px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(56, 189, 248, 0.18) 55%, transparent 75%)',
          filter: 'blur(30px)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* ── 3D Interactive WebGL Star Hero Canvas ── */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleStarTap}
        style={{
          position: 'relative',
          width: '100%',
          height: '210px',
          cursor: 'grab',
          touchAction: 'none',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
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
      </div>

      {/* ── Minimalist Clean Typography Section (Exact from Reference) ── */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '10px',
          width: '100%',
          padding: '0 16px',
          zIndex: 3,
          position: 'relative',
        }}
      >
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: '#FFFFFF',
            letterSpacing: '-0.2px',
            margin: '0 0 8px 0',
          }}
        >
          Telegram Premium
        </h2>

        <p
          style={{
            fontSize: '14px',
            color: '#FFFFFF',
            opacity: 0.92,
            margin: 0,
            fontWeight: 400,
            lineHeight: 1.45,
          }}
        >
          Go <strong style={{ fontWeight: 700 }}>beyond the limits</strong> and unlock dozens of exclusive features by subscribing to <strong style={{ fontWeight: 700 }}>Telegram Premium</strong>.
        </p>
      </div>
    </div>
  );
};

