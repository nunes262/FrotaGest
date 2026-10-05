import { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    font-family: ${({ theme }) => theme.font.family};
    font-size: ${({ theme }) => theme.font.size.md};
    color: ${({ theme }) => theme.color.text};
    background: ${({ theme }) => theme.color.background};
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 { margin: 0; color: ${({ theme }) => theme.color.textStrong}; letter-spacing: 0.15px; }
  button, input, select, textarea { font: inherit; color: inherit; }
  a { color: ${({ theme }) => theme.color.primary}; }
  :focus-visible { outline: 2px solid ${({ theme }) => theme.color.primary}; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
`;
