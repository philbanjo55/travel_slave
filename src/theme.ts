// PHILM+FRAME Design System — Black & White

export const colors = {
  background: '#000000',
  surface: '#111111',
  surfaceElevated: '#1a1a1a',
  border: '#2a2a2a',
  borderSubtle: '#1a1a1a',

  accent: '#ffffff',
  accentDim: '#888888',
  accentSubtle: 'rgba(255,255,255,0.08)',

  textPrimary: '#ffffff',
  textSecondary: '#888888',
  textTertiary: '#444444',
  textInverse: '#000000',

  signalOk: '#5aaa7a',
  signalWarning: '#aaaaaa',
  signalNone: '#555555',
  checked: '#5aaa7a',

  ireland: '#ffffff',
  scotland: '#ffffff',
  travel: '#888888',
  dublin: '#ffffff',

  routeLine: 'rgba(255,255,255,0.35)',
  routeLineActive: '#ffffff',
  pinStop: '#ffffff',
  pinHome: '#5aaa7a',
  pinDepart: '#888888',
};

export const typography = {
  displayLarge: {
    fontFamily: 'Georgia',
    fontSize: 28,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
    color: colors.textPrimary,
  },
  displayMedium: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '400' as const,
    letterSpacing: 0.3,
    color: colors.textPrimary,
  },
  headlineLarge: {
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
    color: colors.textPrimary,
  },
  headlineMedium: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  bodyLarge: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  bodyMedium: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  bodySmall: {
    fontSize: 11,
    fontWeight: '400' as const,
    lineHeight: 16,
    color: colors.textTertiary,
  },
  labelLarge: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    color: colors.textTertiary,
  },
  labelMedium: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color: colors.textTertiary,
  },
  timeLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 4,
  },
  float: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
  },
};
