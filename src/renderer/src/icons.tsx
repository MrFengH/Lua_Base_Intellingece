/** Stroke-drawn icon set for the app shell. Consistent 1.75 stroke, 24 viewBox, no fills — a
 * replacement for the emoji/unicode glyphs the interface used previously. */

interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconLedger = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M6 3.5h9.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M15 3.5V7h4" />
    <path d="M8.25 12h7.5M8.25 15h7.5M8.25 9h3.5" />
  </svg>
);

export const IconFacility = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M4.5 20.5V6l7-3 7 3v14.5" />
    <path d="M3 20.5h18" />
    <path d="M9.5 20.5V16h4v4.5" />
    <path d="M8.5 9h1.25M14 9h1.25M8.5 12.5h1.25M14 12.5h1.25" />
  </svg>
);

export const IconChart = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M4.5 20.5V4.5" />
    <path d="M4.5 20.5h15" />
    <path d="M8 20.5v-6M12.5 20.5v-10M17 20.5v-4" />
  </svg>
);

export const IconMic = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <rect x="9.25" y="3.5" width="5.5" height="10" rx="2.75" />
    <path d="M6 11.25a6 6 0 0 0 12 0" />
    <path d="M12 17.25V20.5M9 20.5h6" />
  </svg>
);

export const IconSend = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M20 4 3.5 10.6c-.6.24-.58 1.1.03 1.31L10.8 14.4l2.5 7.27c.22.63 1.1.63 1.33.02L20 4Z" />
    <path d="M10.8 14.4 20 4" />
  </svg>
);

export const IconCheck = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </svg>
);

export const IconClose = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
  </svg>
);

export const IconChevronLeft = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const IconChevronRight = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </svg>
);

export const IconFlag = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M6 3.5v17" />
    <path d="M6 4.5h11l-3 4 3 4H6" />
  </svg>
);

export const IconInbox = ({ className }: IconProps): React.JSX.Element => (
  <svg className={className} {...base}>
    <path d="M4 12.5 6.5 5h11L20 12.5" />
    <path d="M4 12.5v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" />
    <path d="M4 12.5h5.2c.3 1.4 1.3 2.3 2.8 2.3s2.5-.9 2.8-2.3H20" />
  </svg>
);
