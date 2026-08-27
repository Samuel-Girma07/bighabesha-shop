import React from 'react';

/**
 * Standard Icon Component Properties
 */
export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/* ============================================================================
   BIGHABESHA SHOP — Polished Custom Vector Icon Foundation
   Sub-pixel aligned · Optically balanced · Zero emojis · Accessible
   ========================================================================== */

export const LogoIcon: React.FC<{ size?: number; className?: string }> = ({ size = 28, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="logoBgGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3390EC" />
        <stop offset="1" stopColor="#1C72B8" />
      </linearGradient>
      <linearGradient id="logoSheenGrad" x1="0" y1="0" x2="28" y2="14" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" stopOpacity="0.25" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
    </defs>
    {/* Base Squircle Plate */}
    <rect width="28" height="28" rx="8" fill="url(#logoBgGrad)" />
    <rect width="28" height="28" rx="8" fill="url(#logoSheenGrad)" />
    <rect x="0.5" y="0.5" width="27" height="27" rx="7.5" stroke="rgba(255,255,255,0.2)" />
    {/* Geometric Monogram "BH" */}
    <text
      x="14"
      y="18.5"
      textAnchor="middle"
      fontSize="12.5"
      fontWeight="900"
      fontFamily="-apple-system, BlinkMacSystemFont, 'Inter Tight', 'Inter', sans-serif"
      letterSpacing="-0.5px"
      fill="#FFFFFF"
    >
      BH
    </text>
  </svg>
);

export const SparkleIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

export const StarIcon: React.FC<IconProps & { fill?: string }> = ({ size = 20, color = 'currentColor', fill = 'none', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export const CoinIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M15 9.5a2.5 2.5 0 0 0-5 0c0 2.5 5 1.5 5 4a2.5 2.5 0 0 1-5 0" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

export const ShieldCheckIcon: React.FC<IconProps> = ({ size = 22, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const BankIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
  </svg>
);

export const PhoneIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
    <path d="M12 18h.01" />
  </svg>
);

export const CryptoIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M6 3h12l4 6-10 12L2 9l4-6z" />
    <path d="M12 21 2 9h20L12 21z" />
  </svg>
);

export const ShoppingBagIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

export const PackageIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </svg>
);

export const MessageCircleIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </svg>
);

export const GlobeIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
  </svg>
);

export const UploadCloudIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
    <path d="M12 12v9" />
    <path d="m16 16-4-4-4 4" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Executive Fintech Dashboard Vector Assets (Zero Emojis)
   ───────────────────────────────────────────────────────────── */

export const LayoutDashboardIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

export const BarChartIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

export const KeyIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3" />
  </svg>
);

export const UsersIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const MegaphoneIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const BellIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export const LogOutIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export const ArrowUpRightIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </svg>
);

export const TrendingUpIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);

export const TrendingDownIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
    <polyline points="16 17 22 17 22 11" />
  </svg>
);

export const FilterIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export const DownloadIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const CalendarIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const CheckCircleIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const AlertCircleIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const XCircleIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export const WalletCardsIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="18" height="12" x="3" y="8" rx="2" />
    <path d="M7 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" />
    <circle cx="16" cy="14" r="1" />
  </svg>
);

export const LayersIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.9a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 12.5-9.4 4.3a2 2 0 0 1-1.2 0L2 12.5" />
    <path d="m22 17.5-9.4 4.3a2 2 0 0 1-1.2 0L2 17.5" />
  </svg>
);

export const SendIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export const LockIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const EyeIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const GeminiBrandIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="geminiBrandGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#5B7FFF" />
        <stop offset="0.5" stopColor="#818CF8" />
        <stop offset="1" stopColor="#C084FC" />
      </linearGradient>
    </defs>
    <path
      d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"
      fill="url(#geminiBrandGrad)"
    />
  </svg>
);

export const TelegramBrandIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="tgBrandGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#2AABEE" />
        <stop offset="1" stopColor="#229ED9" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="11" fill="url(#tgBrandGrad)" />
    <path
      d="M17.5 7.2L5.8 11.7C5 12 5 12.5 5.7 12.7L8.7 13.6L15.6 9.3C15.9 9.1 16.2 9.2 16 9.4L10.4 14.5L10.2 17.5C10.5 17.5 10.6 17.4 10.8 17.2L12.3 15.8L15.4 18.1C16 18.4 16.4 18.2 16.6 17.5L18.6 8.1C18.8 7.3 18.3 6.9 17.5 7.2Z"
      fill="#FFFFFF"
    />
  </svg>
);

export const StarsBrandIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="starsBrandGrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFC800" />
        <stop offset="1" stopColor="#FF9500" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="11" fill="url(#starsBrandGrad)" />
    <path
      d="M12 5.5L13.8 9.2L17.9 9.8L14.9 12.7L15.6 16.8L12 14.9L8.4 16.8L9.1 12.7L6.1 9.8L10.2 9.2L12 5.5Z"
      fill="#FFFFFF"
    />
  </svg>
);

/* ─────────────────────────────────────────────────────────────
   Telegram Stars Native 3D Icons & Payment Rail Assets
   ───────────────────────────────────────────────────────────── */

export const TelegramStar3DIcon: React.FC<{ size?: number; className?: string }> = ({ size = 64, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="tgStarGlow" x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFE066" stopOpacity="0.45" />
        <stop offset="1" stopColor="#FF9900" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="tgStarBody" x1="15" y1="10" x2="85" y2="90" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF275" />
        <stop offset="0.3" stopColor="#FFC800" />
        <stop offset="0.75" stopColor="#FFA000" />
        <stop offset="1" stopColor="#E67300" />
      </linearGradient>
      <linearGradient id="tgStarBevelTop" x1="50" y1="12" x2="50" y2="60" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFF9A6" stopOpacity="0.95" />
        <stop offset="1" stopColor="#FFB300" stopOpacity="0.15" />
      </linearGradient>
      <linearGradient id="tgStarShadow" x1="30" y1="50" x2="80" y2="95" gradientUnits="userSpaceOnUse">
        <stop stopColor="#CC5500" stopOpacity="0.65" />
        <stop offset="1" stopColor="#8A2E00" stopOpacity="0.9" />
      </linearGradient>
      <filter id="tgStarFilter" x="-20%" y="-20%" width="140%" height="140%" filterUnits="userSpaceOnUse">
        <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#FF9900" floodOpacity="0.45" />
      </filter>
    </defs>
    {/* Ambient Glow */}
    <circle cx="50" cy="50" r="44" fill="url(#tgStarGlow)" />
    {/* 3D Star Body */}
    <g filter="url(#tgStarFilter)">
      <path
        d="M50 14 C50.8 14 51.7 14.7 52.1 15.6 L62.4 33.6 C62.8 34.3 63.6 34.9 64.4 35.1 L84.8 39.2 C85.8 39.4 86.6 40.2 86.8 41.2 C87.0 42.2 86.5 43.2 85.7 43.9 L71.6 57.6 C71.0 58.2 70.7 59.1 70.8 59.9 L73.2 80.6 C73.3 81.6 72.8 82.6 71.9 83.2 C71.1 83.7 70.0 83.7 69.1 83.1 L50.3 74.3 C49.5 73.9 48.6 73.9 47.8 74.3 L29.0 83.1 C28.1 83.7 27.0 83.7 26.2 83.2 C25.3 82.6 24.8 81.6 24.9 80.6 L27.3 59.9 C27.4 59.1 27.1 58.2 26.5 57.6 L12.4 43.9 C11.6 43.2 11.1 42.2 11.3 41.2 C11.5 40.2 12.3 39.4 13.3 39.2 L33.7 35.1 C34.5 34.9 35.3 34.3 35.7 33.6 L46.0 15.6 C46.4 14.7 47.3 14 48.1 14 Z"
        fill="url(#tgStarBody)"
      />
      {/* Top Facet Highlight */}
      <path
        d="M50 15 L62.4 33.6 C62.8 34.3 63.6 34.9 64.4 35.1 L84.8 39.2 L50 56 Z"
        fill="url(#tgStarBevelTop)"
      />
      <path
        d="M50 15 L46.0 15.6 L35.7 33.6 C35.3 34.3 34.5 34.9 33.7 35.1 L13.3 39.2 L50 56 Z"
        fill="url(#tgStarBevelTop)"
        opacity="0.85"
      />
      {/* Bottom Shadow Depth */}
      <path
        d="M50 56 L71.6 57.6 C71.0 58.2 70.7 59.1 70.8 59.9 L73.2 80.6 L50 74.3 Z"
        fill="url(#tgStarShadow)"
      />
      <path
        d="M50 56 L26.5 57.6 L24.9 80.6 L50 74.3 Z"
        fill="url(#tgStarShadow)"
        opacity="0.65"
      />
    </g>
  </svg>
);

export const MiniStarIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="miniStarGrad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFD000" />
        <stop offset="1" stopColor="#FF8C00" />
      </linearGradient>
    </defs>
    <path
      d="M12 2.5L14.9 8.3C15.2 8.9 15.8 9.3 16.5 9.4L22.8 10.3C23.6 10.4 24 11.4 23.4 12L18.8 16.4C18.3 16.9 18.1 17.6 18.2 18.3L19.3 24.5C19.5 25.3 18.6 26 17.9 25.6L12.3 22.6C11.7 22.3 10.9 22.3 10.3 22.6L4.7 25.6C4 26 3.1 25.3 3.3 24.5L4.4 18.3C4.5 17.6 4.3 16.9 3.8 16.4L-0.8 12C-1.4 11.4 -1 10.4 -0.2 10.3L6.1 9.4C6.8 9.3 7.4 8.9 7.7 8.3L10.6 2.5C11 1.7 12.1 1.7 12.5 2.5H12Z"
      transform="scale(0.8) translate(3, 2)"
      fill="url(#miniStarGrad)"
    />
  </svg>
);

export const GiftIcon: React.FC<IconProps> = ({ size = 18, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect width="20" height="5" x="2" y="7" rx="1" />
    <line x1="12" y1="22" x2="12" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);

export const TierShieldGoldIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="goldShieldGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFE066" />
        <stop offset="0.5" stopColor="#F59E0B" />
        <stop offset="1" stopColor="#B45309" />
      </linearGradient>
    </defs>
    <path d="M12 2L4 5V11C4 16.5 7.4 21.6 12 23C16.6 21.6 20 16.5 20 11V5L12 2Z" fill="url(#goldShieldGrad)" />
    <path d="M12 7L13.5 10.5L17.2 11.1L14.5 13.7L15.1 17.4L12 15.7L8.9 17.4L9.5 13.7L6.8 11.1L10.5 10.5L12 7Z" fill="#FFFFFF" />
  </svg>
);

export const TierShieldSilverIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="silverShieldGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F1F5F9" />
        <stop offset="0.5" stopColor="#94A3B8" />
        <stop offset="1" stopColor="#475569" />
      </linearGradient>
    </defs>
    <path d="M12 2L4 5V11C4 16.5 7.4 21.6 12 23C16.6 21.6 20 16.5 20 11V5L12 2Z" fill="url(#silverShieldGrad)" />
    <path d="M12 7L13.5 10.5L17.2 11.1L14.5 13.7L15.1 17.4L12 15.7L8.9 17.4L9.5 13.7L6.8 11.1L10.5 10.5L12 7Z" fill="#FFFFFF" />
  </svg>
);

export const TierShieldBronzeIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="bronzeShieldGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FDBA74" />
        <stop offset="0.5" stopColor="#C2410C" />
        <stop offset="1" stopColor="#7C2D12" />
      </linearGradient>
    </defs>
    <path d="M12 2L4 5V11C4 16.5 7.4 21.6 12 23C16.6 21.6 20 16.5 20 11V5L12 2Z" fill="url(#bronzeShieldGrad)" />
    <path d="M12 7L13.5 10.5L17.2 11.1L14.5 13.7L15.1 17.4L12 15.7L8.9 17.4L9.5 13.7L6.8 11.1L10.5 10.5L12 7Z" fill="#FFFFFF" />
  </svg>
);

export const ETBCurrencyIcon: React.FC<{ size?: number; color?: string; className?: string }> = ({ size = 18, color = '#FFFFFF', className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="24" height="24" rx="6" fill="#1C1C1E" stroke="rgba(255,255,255,0.16)" />
    <text
      x="12"
      y="16"
      textAnchor="middle"
      fontSize="10"
      fontWeight="900"
      fontFamily="-apple-system, BlinkMacSystemFont, 'Inter Tight', sans-serif"
      letterSpacing="-0.3px"
      fill={color}
    >
      ETB
    </text>
  </svg>
);

export const TONDiamondIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 2L3 8L12 22L21 8L12 2Z" fill="#0088CC" />
    <path d="M12 2L3 8H21L12 2Z" fill="#24A1DE" />
    <path d="M12 8L7 14L12 22L17 14L12 8Z" fill="#FFFFFF" opacity="0.3" />
  </svg>
);

export const USDCoinIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="10" fill="#2775CA" />
    <text
      x="12"
      y="16.5"
      textAnchor="middle"
      fontSize="13"
      fontWeight="900"
      fontFamily="-apple-system, BlinkMacSystemFont, 'Inter Tight', sans-serif"
      fill="#FFFFFF"
    >
      $
    </text>
  </svg>
);

export const PaymentCbeIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="24" height="24" rx="6" fill="#6B21A8" />
    <path d="M12 4L4 8V10H20V8L12 4Z" fill="#FBBF24" />
    <rect x="5" y="11" width="3" height="6" fill="#FFFFFF" />
    <rect x="10.5" y="11" width="3" height="6" fill="#FFFFFF" />
    <rect x="16" y="11" width="3" height="6" fill="#FFFFFF" />
    <rect x="4" y="18" width="16" height="2" fill="#FBBF24" />
  </svg>
);

export const PaymentTelebirrIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="24" height="24" rx="6" fill="#0284C7" />
    <path d="M7 6H17V9H13.5V18H10.5V9H7V6Z" fill="#FFFFFF" />
    <circle cx="16" cy="16" r="2.5" fill="#38BDF8" />
  </svg>
);

export const PaymentAbyssiniaIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <rect width="24" height="24" rx="6" fill="#C2410C" />
    <circle cx="12" cy="12" r="7" stroke="#FDE047" strokeWidth="2.5" />
    <path d="M12 7V17M7 12H17" stroke="#FFFFFF" strokeWidth="2" />
  </svg>
);

export const SparklesCanopyIcon: React.FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 2L13.2 5.8L17 7L13.2 8.2L12 12L10.8 8.2L7 7L10.8 5.8L12 2Z" fill="#FFD700" />
    <path d="M19 14L19.7 16.3L22 17L19.7 17.7L19 20L18.3 17.7L16 17L18.3 16.3L19 14Z" fill="#FFB800" opacity="0.8" />
    <path d="M5 15L5.6 17L7.5 17.5L5.6 18L5 20L4.4 18L2.5 17.5L4.4 17L5 15Z" fill="#FFE57F" opacity="0.7" />
  </svg>
);

export const CrownIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
  </svg>
);

export const ZapIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const CameraIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

export const HelpCircleIcon: React.FC<IconProps> = ({ size = 20, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16, color = 'currentColor', className, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const VerifiedBadge3DIcon: React.FC<{ size?: number; className?: string }> = ({ size = 52, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="verifiedBg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38BDF8" />
        <stop offset="0.5" stopColor="#0284C7" />
        <stop offset="1" stopColor="#0369A1" />
      </linearGradient>
      <linearGradient id="checkGlow" x1="18" y1="18" x2="46" y2="46" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#E0F2FE" />
      </linearGradient>
      <filter id="badgeShadow" x="0" y="2" width="64" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#0284C7" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#badgeShadow)">
      {/* 8-pointed smooth star badge */}
      <path
        d="M32 6L37.8 12.2L46.2 11.2L48.8 19.3L56.5 22.8L54.8 31.1L59.6 38L53.9 44.2L54.4 52.6L46.3 54.8L42.5 62.3L34.3 60.3L28 64L23.4 56.9L15 56.1L14.4 47.7L7.3 43.1L10.2 35.1L6 28L12.4 22.5L12.8 14.1L21 13.1L25.8 6L32 6Z"
        fill="url(#verifiedBg)"
      />
      {/* Glossy overlay */}
      <path
        d="M32 7.5C45.5 7.5 56.5 18.5 56.5 32C56.5 34.2 56.2 36.3 55.6 38.3C52.2 24.5 42.5 14.5 30.1 11.8C25.4 10.8 20.6 11.4 16.2 13.2C20.7 9.6 26.1 7.5 32 7.5Z"
        fill="#FFFFFF"
        fillOpacity="0.25"
      />
      {/* Bold Checkmark */}
      <path
        d="M23 32.5L29 38.5L41.5 24.5"
        stroke="url(#checkGlow)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Sparkles */}
      <circle cx="16" cy="18" r="1.5" fill="#FFFFFF" />
      <circle cx="48" cy="18" r="1.5" fill="#FFFFFF" />
      <circle cx="50" cy="46" r="1.2" fill="#FFFFFF" />
    </g>
  </svg>
);

export const GeminiPro3DIcon: React.FC<{ size?: number; className?: string }> = ({ size = 52, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="geminiGrad" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
        <stop stopColor="#818CF8" />
        <stop offset="0.4" stopColor="#6366F1" />
        <stop offset="0.75" stopColor="#A855F7" />
        <stop offset="1" stopColor="#EC4899" />
      </linearGradient>
      <linearGradient id="geminiSheen" x1="32" y1="8" x2="32" y2="40" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FFFFFF" stopOpacity="0.5" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
      <filter id="geminiShadow" x="0" y="2" width="64" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#6366F1" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#geminiShadow)">
      {/* Squircle Rounded Container */}
      <rect x="6" y="6" width="52" height="52" rx="16" fill="#131B2E" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#geminiGrad)" fillOpacity="0.2" />
      {/* Gemini 4-Point Radiant Core */}
      <path
        d="M32 14C32 23.9411 23.9411 32 14 32C23.9411 32 32 40.0589 32 50C32 40.0589 40.0589 32 50 32C40.0589 32 32 23.9411 32 14Z"
        fill="url(#geminiGrad)"
      />
      <path
        d="M32 14C32 23.9411 23.9411 32 14 32C23.9411 32 32 40.0589 32 50C32 40.0589 40.0589 32 50 32C40.0589 32 32 23.9411 32 14Z"
        fill="url(#geminiSheen)"
      />
      <circle cx="45" cy="17" r="2" fill="#F472B6" />
      <circle cx="19" cy="45" r="1.5" fill="#60A5FA" />
    </g>
  </svg>
);

export const ReferralMoney3DIcon: React.FC<{ size?: number; className?: string }> = ({ size = 52, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="goldPlateGrad" x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
        <stop stopColor="#F59E0B" />
        <stop offset="0.5" stopColor="#D97706" />
        <stop offset="1" stopColor="#B45309" />
      </linearGradient>
      <linearGradient id="billGrad1" x1="12" y1="18" x2="52" y2="46" gradientUnits="userSpaceOnUse">
        <stop stopColor="#34D399" />
        <stop offset="1" stopColor="#059669" />
      </linearGradient>
      <filter id="moneyShadow" x="0" y="2" width="64" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#F59E0B" floodOpacity="0.4" />
      </filter>
    </defs>
    <g filter="url(#moneyShadow)">
      <rect x="6" y="6" width="52" height="52" rx="16" fill="#1C1E14" stroke="rgba(245,158,11,0.25)" strokeWidth="1.5" />
      <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#goldPlateGrad)" fillOpacity="0.12" />
      {/* Tilted Cash Notes */}
      <rect x="14" y="26" width="34" height="20" rx="3" transform="rotate(-12 14 26)" fill="url(#billGrad1)" stroke="#A7F3D0" strokeWidth="1" />
      <rect x="18" y="22" width="34" height="20" rx="3" transform="rotate(4 18 22)" fill="#10B981" stroke="#D1FAE5" strokeWidth="1" />
      <circle cx="35" cy="32" r="4.5" fill="#047857" />
      <text x="35" y="35" textAnchor="middle" fontSize="6.5" fontWeight="900" fill="#ECFDF5" fontFamily="sans-serif">$</text>
      {/* Gold Coins Stack */}
      <circle cx="46" cy="42" r="7" fill="#FBBF24" stroke="#F59E0B" strokeWidth="1.5" />
      <circle cx="46" cy="42" r="5" fill="#F59E0B" />
      <text x="46" y="44.5" textAnchor="middle" fontSize="6.5" fontWeight="900" fill="#FEF3C7" fontFamily="sans-serif">★</text>
    </g>
  </svg>
);

export const SupportAgent3DIcon: React.FC<{ size?: number; className?: string }> = ({ size = 52, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="supportPlateGrad" x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
        <stop stopColor="#06B6D4" />
        <stop offset="1" stopColor="#0891B2" />
      </linearGradient>
      <filter id="supportShadow" x="0" y="2" width="64" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#06B6D4" floodOpacity="0.35" />
      </filter>
    </defs>
    <g filter="url(#supportShadow)">
      <rect x="6" y="6" width="52" height="52" rx="16" fill="#0E1E26" stroke="rgba(6,182,212,0.25)" strokeWidth="1.5" />
      <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#supportPlateGrad)" fillOpacity="0.15" />
      {/* Support Headset & Chat bubble */}
      <path
        d="M20 32C20 25.3726 25.3726 20 32 20C38.6274 20 44 25.3726 44 32V38C44 39.6569 42.6569 41 41 41H38V31H42V32C42 26.4772 37.5228 22 32 22C26.4772 22 22 26.4772 22 32V31H26V41H23C21.3431 41 20 39.6569 20 38V32Z"
        fill="#22D3EE"
      />
      <path
        d="M38 41V43C38 44.6569 36.6569 46 35 46H30"
        stroke="#22D3EE"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="29" cy="46" r="2" fill="#22D3EE" />
      {/* Active Online Indicator */}
      <circle cx="48" cy="18" r="4.5" fill="#10B981" stroke="#0E1E26" strokeWidth="2" />
    </g>
  </svg>
);

export const LocalPaymentGroupBadge: React.FC<{ size?: number; className?: string }> = ({ className }) => (
  <div className={`inline-flex items-center gap-1.5 ${className || ''}`}>
    {/* Telebirr dot */}
    <span className="w-5 h-5 rounded-full bg-[#0284C7] flex items-center justify-center text-[9px] font-black text-white shadow-sm ring-1 ring-white/20">T</span>
    {/* CBE dot */}
    <span className="w-5 h-5 rounded-full bg-[#6B21A8] flex items-center justify-center text-[9px] font-black text-[#FBBF24] shadow-sm ring-1 ring-white/20">C</span>
    {/* Abyssinia dot */}
    <span className="w-5 h-5 rounded-full bg-[#C2410C] flex items-center justify-center text-[9px] font-black text-white shadow-sm ring-1 ring-white/20">A</span>
  </div>
);


