// Tokens baseados no design system myHonda 2.0 usado no protótipo
export const theme = {
  color: {
    primary: '#cc0000',
    primaryHover: '#a30000',
    primaryTint: '#fbebeb',
    text: '#3d3d3d',
    textStrong: '#292929',
    textSoft: '#525252',
    textInvert: '#ffffff',
    surface: '#ffffff',
    background: '#f5f5f5',
    border: '#e0e0e0',
    borderStrong: '#525252',
    disabled: '#b8b8b8',
    success: '#27ae60',
    successTint: '#e2f5ea',
    successInk: '#1b7a44',
    caution: '#f3aa3c',
    cautionTint: '#fdf1de',
    cautionInk: '#966925',
    warning: '#ff6600',
    warningTint: '#fff0e5',
    warningInk: '#ba4a00',
    danger: '#ff4c4c',
    dangerTint: '#ffe9e9',
    dangerInk: '#cc3d3d',
    neutralTint: '#ececec',
  },
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
    size: { xs: '10px', sm: '12px', md: '14px', lg: '16px', xl: '20px', h2: '24px', h1: '32px' },
    weight: { regular: 400, semibold: 600, bold: 700 },
  },
  space: (n: number) => `${n * 8}px`,
  radius: '8px',
  shadow: {
    soft: '0 0 4px rgba(0, 0, 0, 0.08)',
    card: '0 0 4px rgba(0, 0, 0, 0.16)',
    red: '0 0 4px rgba(204, 0, 0, 0.48)',
  },
  // Até essa largura (celular e tablet) o menu lateral vira uma barra de abas embaixo
  media: { compact: '(max-width: 900px)' },
  tabBarHeight: '64px',
} as const;

export type AppTheme = typeof theme;
