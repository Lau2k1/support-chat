import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import { Avatar } from '@mui/material';
import { alpha } from '@mui/material/styles';

/**
 * Палитра инициалов. Цвет выводится из имени, поэтому он стабилен между
 * рендерами (в отличие от индекса в списке) и помогает различать клиентов
 * в длинном списке чатов, где настоящих аватаров нет — ни у клиентов виджета,
 * ни в Telegram-профилях фото не хранится.
 */
const INITIAL_TONES = ['#007bff', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#6366f1'];

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return INITIAL_TONES[Math.abs(hash) % INITIAL_TONES.length];
}

/** До двух инициалов: «Александр Петров» → «АП», «Александр» → «А». */
function initialsOf(name?: string | null): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

interface Props {
  name?: string | null;
  /** Что показать, когда имени нет: у клиента виджета его собирать неоткуда. */
  fallback?: string;
  /** Иконка канала вместо буквы (например, для Telegram). */
  icon?: ReactNode;
  size?: number;
  /** 'soft' — инициалы, 'solid' — фирменная заливка (для аватара оператора). */
  variant?: 'soft' | 'solid';
  sx?: SxProps<Theme>;
}

export default function UserAvatar({ name, fallback = 'К', icon, size = 36, variant = 'soft', sx }: Props) {
  if (variant === 'solid') {
    return (
      <Avatar
        sx={{
          width: size,
          height: size,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          fontSize: Math.round(size * 0.4),
          fontWeight: 600,
          ...sx,
        }}
      >
        {icon || initialsOf(name) || fallback}
      </Avatar>
    );
  }

  const initials = initialsOf(name);
  const tone = initials ? toneFor(name || '') : undefined;

  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        // Тонированный фон с текстом того же цвета работает в обеих схемах:
        // сплошная заливка потребовала бы отдельного «тёмного» набора.
        bgcolor: icon ? 'infoBg' : tone ? alpha(tone, 0.16) : 'action.hover',
        color: icon ? 'info.main' : tone ?? 'text.secondary',
        border: '1px solid',
        borderColor: icon ? 'transparent' : tone ? alpha(tone, 0.28) : 'divider',
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        ...sx,
      }}
    >
      {icon || initials || fallback}
    </Avatar>
  );
}
