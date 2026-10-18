import type { SxProps, Theme } from '@mui/material/styles';
import { Box } from '@mui/material';

export type PresenceStatus = 'online' | 'busy' | 'offline';

const STATUS_TOKEN: Record<PresenceStatus, string> = {
  online: 'statusOnline',
  busy: 'statusBusy',
  offline: 'statusOffline',
};

interface Props {
  status: PresenceStatus;
  size?: number;
  sx?: SxProps<Theme>;
}

/** Точка присутствия. Цвет — из палитры, чтобы читаться в обеих схемах. */
export default function StatusDot({ status, size = 8, sx }: Props) {
  return (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: STATUS_TOKEN[status],
        display: 'inline-block',
        flexShrink: 0,
        ...sx,
      }}
    />
  );
}
