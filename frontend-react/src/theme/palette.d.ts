import '@mui/material/styles';

/**
 * Semantic tokens used by status chips/tags. They exist as palette entries (not
 * local constants) so they invert together with the active color scheme: the
 * pastel-on-light pairs would fail contrast on dark paper. Each scheme declares
 * its own values in theme/index.ts.
 */
declare module '@mui/material/styles' {
  interface Palette {
    ok: string;
    okBg: string;
    bad: string;
    badBg: string;
    warn: string;
    warnBg: string;
    infoBg: string;
  }

  interface PaletteOptions {
    ok?: string;
    okBg?: string;
    bad?: string;
    badBg?: string;
    warn?: string;
    warnBg?: string;
    infoBg?: string;
  }
}
