import React, { useState, useRef } from 'react';

export const TelegramPremium3DStar: React.FC<{ className?: string }> = ({ className }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState<{ rx: number; ry: number; active: boolean }>({ rx: 0, ry: 0, active: false });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rx: -y * 22,
      ry: x * 26,
      active: true,
    });
  };

  const handlePointerLeave = () => {
    setTilt({ rx: 0, ry: 0, active: false });
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`premium-star-showcase ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: '20px',
        padding: '16px 12px 14px 12px',
        marginBottom: '16px',
        background: 'radial-gradient(ellipse at 50% 35%, #182236 0%, #0B101C 85%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        perspective: '1000px',
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Dynamic Purple/Blue Background Nebula Glow */}
      <div
        style={{
          position: 'absolute',
          top: '25%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '160px',
          height: '140px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.35) 0%, rgba(56, 189, 248, 0.15) 60%, transparent 80%)',
          filter: 'blur(24px)',
          pointerEvents: 'none',
          zIndex: 1,
          animation: 'pulseGlow 4s ease-in-out infinite alternate',
        }}
      />

      {/* 3D Floating Hero Container with Interactive Tilt Physics */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '280px',
          height: '145px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
          transform: tilt.active
            ? `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale3d(1.04, 1.04, 1.04)`
            : 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
          transition: tilt.active ? 'transform 0.08s ease-out' : 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Authentic Telegram Premium Star & Constellation Artwork */}
        <img
          src="/icons/telegram_premium_star.jpg"
          alt="Telegram Premium Star"
          style={{
            maxWidth: '100%',
            maxHeight: '135px',
            objectFit: 'contain',
            borderRadius: '12px',
            filter: 'drop-shadow(0 10px 24px rgba(168, 85, 247, 0.45)) drop-shadow(0 2px 8px rgba(56, 189, 248, 0.3))',
            animation: 'floatingStar 3.8s ease-in-out infinite',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      </div>

      {/* Distinct Typography Section with Zero Overlap */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '10px',
          zIndex: 3,
          position: 'relative',
        }}
      >
        <div
          style={{
            fontSize: '16.5px',
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '-0.2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <span>Telegram Premium</span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 800,
              padding: '2px 7px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #A855F7 0%, #38BDF8 100%)',
              color: '#FFFFFF',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}
          >
            PRO
          </span>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: '#94A3B8',
            marginTop: '3px',
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          Go beyond limits with double quotas, 4GB uploads & exclusive star badge
        </div>
      </div>

      {/* Embedded CSS Animations */}
      <style>{`
        @keyframes floatingStar {
          0%, 100% {
            transform: translateY(0px) rotate(-0.5deg);
          }
          50% {
            transform: translateY(-7px) rotate(1.2deg);
          }
        }
        @keyframes pulseGlow {
          0% {
            opacity: 0.35;
            transform: translate(-50%, -50%) scale(0.92);
          }
          100% {
            opacity: 0.75;
            transform: translate(-50%, -50%) scale(1.12);
          }
        }
      `}</style>
    </div>
  );
};
