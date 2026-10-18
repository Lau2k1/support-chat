import '@mui/material/styles';

/**
 * Semantic tokens used by status chips/tags. They exist as palette entries (not
 * local constants) so they invert together with the active color scheme: the
 * pastel-on-light pairs would fail contrast on dark paper. Each scheme declares
 * its own values in theme/index.ts.
 *
 * The nav* group describes the panel chrome, which keeps its dark plate in both
 * schemes (the left rail must not turn white in light mode). The status* group
 * used to be a hardcoded map in TopBar; as palette entries the same dots read
 * correctly on white paper and on the dark navy canvas.
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
    navBg: string;
    navActive: string;
    navText: string;
    navTextActive: string;
    statusOnline: string;
    statusBusy: string;
    statusOffline: string;
  }

  interface PaletteOptions {
    ok?: string;
    okBg?: string;
    bad?: string;
    badBg?: string;
    warn?: string;
    warnBg?: string;
    infoBg?: string;
    navBg?: string;
    navActive?: string;
    navText?: string;
    navTextActive?: string;
    statusOnline?: string;
    statusBusy?: string;
    statusOffline?: string;
  }
}
