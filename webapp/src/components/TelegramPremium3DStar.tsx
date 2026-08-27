import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { haptic } from '../haptics';

// ═════════════════════════════════════════════════════════════════════
// 1. EXACT OFFICIAL TELEGRAM STAR GEOMETRY (Matching stars design.jpg)
// Symmetrical, chubby, smooth vector curves with paper-plane crease fold
// ═════════════════════════════════════════════════════════════════════
function createTelegramStarShape(): THREE.Shape {
  const shape = new THREE.Shape();

  // Top Apex (Center Top, rounded cap)
  shape.moveTo(-0.24, 0.82);
  shape.bezierCurveTo(-0.14, 1.05, 0.14, 1.05, 0.24, 0.82);

  // Top-Right Valley
  shape.bezierCurveTo(0.28, 0.65, 0.38, 0.44, 0.46, 0.36);

  // Top-Right Arm
  shape.bezierCurveTo(0.70, 0.36, 0.96, 0.32, 1.08, 0.22);
  shape.bezierCurveTo(1.18, 0.14, 1.15, -0.04, 1.02, -0.10);

  // Bottom-Right Valley
  shape.bezierCurveTo(0.78, -0.18, 0.56, -0.26, 0.46, -0.36);

  // Bottom-Right Arm
  shape.bezierCurveTo(0.55, -0.62, 0.68, -0.88, 0.72, -1.02);
  shape.bezierCurveTo(0.75, -1.16, 0.58, -1.22, 0.46, -1.12);

  // Bottom-Center Saddle Notch
  shape.bezierCurveTo(0.30, -0.85, 0.15, -0.56, 0.0, -0.42);

  // Bottom-Left Arm
  shape.bezierCurveTo(-0.15, -0.56, -0.30, -0.85, -0.46, -1.12);
  shape.bezierCurveTo(-0.58, -1.22, -0.75, -1.16, -0.72, -1.02);

  // Bottom-Left Outer Hip
  shape.bezierCurveTo(-0.65, -0.80, -0.52, -0.44, -0.44, -0.12);

  // Signature Crease (Horizontal Paper-Plane Slit)
  shape.lineTo(0.04, -0.02);
  shape.lineTo(-0.44, 0.08);

  // Top-Left Arm
  shape.bezierCurveTo(-0.66, 0.14, -0.96, 0.18, -1.08, 0.22);
  shape.bezierCurveTo(-1.18, 0.26, -1.16, 0.44, -1.02, 0.48);

  // Top-Left Valley
  shape.bezierCurveTo(-0.82, 0.52, -0.56, 0.42, -0.46, 0.36);
  shape.bezierCurveTo(-0.38, 0.44, -0.28, 0.65, -0.24, 0.82);

  return shape;
}

// 4-pointed cross star geometry for background twinkling sparkles
function createSparkleGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const outer = 0.16;
  const inner = 0.028;
  
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
    // Upright forward-facing resting orientation matching stars design.jpg
    targetRotX: 0.06,
    targetRotY: 0.0,
    currentRotX: 0.06,
    currentRotY: 0.0,
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
    }, 150);

    // Stardust burst particles
    const sparkleGeom = createSparkleGeometry();
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(0.78 + Math.random() * 0.16, 0.95, 0.8),
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const pMesh = new THREE.Mesh(sparkleGeom, mat);
      pMesh.position.set(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.2 + 0.15
      );
      const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 0.035 + Math.random() * 0.04;
      const scale = 0.4 + Math.random() * 0.45;
      pMesh.scale.set(scale, scale, scale);

      engine.scene.add(pMesh);
      engine.burstParticles.push({
        mesh: pMesh,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (Math.random() - 0.5) * 0.02,
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
    const height = 86;

    // ── SCENE & CAMERA ──
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    camera.position.set(0, 0, 4.3);

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

    // ── 3D STAR MESH (Ultra smooth spline with clean chamfer bevel) ──
    const starShape = createTelegramStarShape();
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.18,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.022,
      bevelThickness: 0.022,
      curveSegments: 32,
    };
    const starGeometry = new THREE.ExtrudeGeometry(starShape, extrudeSettings);
    starGeometry.center();
    starGeometry.computeVertexNormals();

    // ── PBR GRADIENT MATERIAL ──
    const starMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xA855F7,
      metalness: 0.12,
      roughness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      reflectivity: 0.95,
      iridescence: 0.20,
      iridescenceIOR: 1.3,
    });

    // Vertical Spatial Gradient Shader Modification (Matching stars design.jpg)
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
        // Smooth Telegram Violet to Azure Blue Gradient (stars design.jpg)
        float gradT = clamp((vModelPosition.y + 0.90) / 1.80, 0.0, 1.0);
        
        // Exact colors from stars design.jpg:
        // Top Face: Bright Lilac / Magenta (#D946EF -> #C084FC)
        // Bottom Face: Electric Azure / Cyan Blue (#38BDF8 -> #60A5FA)
        vec3 colBottom = vec3(0.22, 0.62, 0.98);
        vec3 colMid = vec3(0.60, 0.32, 0.96);
        vec3 colTop = vec3(0.85, 0.40, 0.98);
        
        vec3 gradCol = mix(colBottom, colMid, smoothstep(0.0, 0.50, gradT));
        gradCol = mix(gradCol, colTop, smoothstep(0.48, 1.0, gradT));
        
        // Crisp Fresnel rim glow
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(dot(vNormalVec, vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
        vec3 rimGlow = mix(vec3(0.2, 0.75, 1.0), vec3(0.88, 0.45, 1.0), gradT) * fresnel * 0.45;
        
        gl_FragColor.rgb = gl_FragColor.rgb * gradCol * 1.45 + rimGlow;
        `
      );
    };

    const starMesh = new THREE.Mesh(starGeometry, starMaterial);
    starMesh.scale.set(0.96, 0.96, 0.96);
    scene.add(starMesh);

    // ── LIGHTING SETUP ──
    const ambientLight = new THREE.AmbientLight(0xdbeafe, 1.0);
    scene.add(ambientLight);

    // Key Light (Top-Left Magenta)
    const keyLight = new THREE.DirectionalLight(0xe879f9, 2.4);
    keyLight.position.set(-3, 4, 4);
    scene.add(keyLight);

    // Fill Light (Bottom-Right Cyan)
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    fillLight.position.set(3, -3, 3);
    scene.add(fillLight);

    // Front Point Light for Gloss Highlight
    const frontLight = new THREE.PointLight(0xffffff, 2.0, 8);
    frontLight.position.set(0, 0, 3.5);
    scene.add(frontLight);

    // ── 3D STAR CONSTELLATION (Matching stars design.jpg) ──
    const sparklesGroup = new THREE.Group();
    const sparkleGeom = createSparkleGeometry();
    const sparkleCount = 32;
    const sparkleItems: { mesh: THREE.Mesh; phase: number; speed: number; baseScale: number }[] = [];

    for (let i = 0; i < sparkleCount; i++) {
      const isTop = Math.random() > 0.4;
      const color = isTop ? 0xc084fc : 0x38bdf8;
      const mat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.35 ? color : 0xffffff,
        transparent: true,
        opacity: 0.65 + Math.random() * 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(sparkleGeom, mat);
      const radius = 1.0 + Math.random() * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const x = Math.cos(theta) * radius * 1.35;
      const y = Math.sin(theta) * radius * 0.85;
      const z = (Math.random() - 0.5) * 1.4;

      mesh.position.set(x, y, z);
      const baseScale = 0.28 + Math.random() * 0.50;
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
    engine.pointLight = frontLight;

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
        const hoverY = Math.sin(engine.time * 1.8) * 0.03;
        const wobbleZ = Math.sin(engine.time * 1.2) * 0.02;
        starMesh.position.y = hoverY;
        starMesh.rotation.z = wobbleZ;

        // Apply friction to drag velocity
        engine.velX *= 0.92;
        engine.velY *= 0.92;
        engine.targetRotY += engine.velX;
        engine.targetRotX += engine.velY;

        // Clamp Pitch
        engine.targetRotX = Math.max(-0.45, Math.min(0.55, engine.targetRotX));
      }

      // Smooth Lerp to target rotation
      engine.currentRotX += (engine.targetRotX - engine.currentRotX) * 0.12;
      engine.currentRotY += (engine.targetRotY - engine.currentRotY) * 0.12;

      starMesh.rotation.x = engine.currentRotX;
      starMesh.rotation.y = engine.currentRotY;

      // Smooth Scale lerp
      engine.currentScale += (engine.targetScale - engine.currentScale) * 0.16;
      starMesh.scale.set(
        0.96 * engine.currentScale,
        0.96 * engine.currentScale,
        0.96 * engine.currentScale
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
        p.mesh.scale.set(pScale * 0.40, pScale * 0.40, pScale * 0.40);
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
      engine.targetRotX = 0.06 - normY * 0.16;
      engine.targetRotY = 0.0 + normX * 0.22;
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
        padding: '0',
        userSelect: 'none',
      }}
    >
      {/* ── Soft Atmospheric Radial Glow ── */}
      <div
        style={{
          position: 'absolute',
          top: '45%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '150px',
          height: '80px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(56, 189, 248, 0.18) 60%, transparent 80%)',
          filter: 'blur(20px)',
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
          height: '86px',
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

      {/* ── Compact Sleek Title ── */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '0px',
          marginBottom: '6px',
          width: '100%',
          padding: '0 12px',
          zIndex: 3,
          position: 'relative',
        }}
      >
        <h2
          style={{
            fontSize: '16.5px',
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          Telegram Premium
        </h2>
      </div>
    </div>
  );
};
