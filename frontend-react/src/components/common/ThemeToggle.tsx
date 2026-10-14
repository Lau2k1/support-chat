import { useState } from 'react';
import {
  Box,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import CheckIcon from '@mui/icons-material/Check';
import { useColorScheme } from '@mui/material/styles';

interface Props {
  /** Set on the dark side navs so the icon/label stay legible on their fixed slate background. */
  onDarkSurface?: boolean;
  /** Render as a side-nav footer row (icon + label) instead of a bare icon button. */
  row?: boolean;
  /** Row text color — each side nav footer uses its own slate/gray shade. */
  rowColor?: string;
  rowHoverColor?: string;
}

const OPTIONS = [
  { value: 'system', label: 'Как в системе', icon: SettingsBrightnessIcon },
  { value: 'light', label: 'Светлая', icon: LightModeIcon },
  { value: 'dark', label: 'Тёмная', icon: DarkModeIcon },
] as const;

/**
 * Theme mode switcher. Offers all three modes (system / light / dark) rather
 * than a plain two-state toggle, so a user who once picked a mode can return to
 * following the OS setting. The pick is persisted by ThemeProvider under
 * 'sc_theme_mode' and applied pre-paint by the script in index.html.
 */
export default function ThemeToggle({
  onDarkSurface = false,
  row = false,
  rowColor = '#94a3b8',
  rowHoverColor = '#e2e8f0',
}: Props) {
  const { mode, colorScheme, setMode } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const isDark = colorScheme === 'dark';
  const CurrentIcon = isDark ? DarkModeIcon : LightModeIcon;
  const currentLabel = OPTIONS.find((o) => o.value === mode)?.label ?? 'Как в системе';

  return (
    <>
      {row ? (
        <Box
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: rowColor,
            cursor: 'pointer',
            fontSize: 12,
            mb: 1.2,
            '&:hover': { color: rowHoverColor },
          }}
        >
          <CurrentIcon sx={{ fontSize: 14 }} />
          Тема: {currentLabel}
        </Box>
      ) : (
        <Tooltip title="Тема оформления">
          <IconButton
            size="small"
            aria-label="Тема оформления"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ color: onDarkSurface ? '#94a3b8' : 'text.secondary' }}
          >
            <CurrentIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <MenuItem
            key={value}
            selected={mode === value}
            onClick={() => {
              setMode(value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{label}</ListItemText>
            {mode === value && <CheckIcon fontSize="small" sx={{ ml: 1, opacity: 0.6 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
