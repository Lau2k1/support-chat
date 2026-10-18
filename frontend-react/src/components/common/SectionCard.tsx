import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import { Box, Typography } from '@mui/material';

interface Props {
  title: string;
  /** Ссылка/кнопка справа от заголовка («Показать все», «Добавить»). */
  action?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

/** Секция правой панели: подпись капсом + содержимое, разделитель снизу. */
export default function SectionCard({ title, action, children, sx }: Props) {
  return (
    <Box sx={{ px: 1.75, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', ...sx }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'text.secondary' }}
        >
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}
