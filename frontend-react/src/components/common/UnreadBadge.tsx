import type { SxProps, Theme } from '@mui/material/styles';
import { Box } from '@mui/material';

interface Props {
  count: number;
  sx?: SxProps<Theme>;
}

/** Счётчик непрочитанных. Ничего не рисует при нуле. */
export default function UnreadBadge({ count, sx }: Props) {
  if (!count) return null;

  return (
    <Box
      sx={{
        minWidth: 20,
        height: 20,
        px: 0.75,
        borderRadius: '10px',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...sx,
      }}
    >
      {count > 99 ? '99+' : count}
    </Box>
  );
}
