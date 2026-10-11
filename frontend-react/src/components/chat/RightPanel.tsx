import { Box, Typography, Divider } from '@mui/material';
import { useChatStore } from '@/stores/chatStore';

interface RightPanelProps {
  /** Inserts a canned response into the message input. */
  onInsertTemplate?: (content: string) => void;
}

export default function RightPanel({ onInsertTemplate }: RightPanelProps) {
  const { cannedResponses, currentChatId, chatNames, chatPublicCodes, chatAssignees, chatSources } = useChatStore();
  const key = currentChatId != null ? String(currentChatId) : '';
  const clientName = currentChatId ? chatNames[key] : undefined;
  const publicCode = currentChatId ? (chatPublicCodes[key] || `#${currentChatId}`) : '—';
  const assignee = currentChatId ? chatAssignees[key] : undefined;
  const source = currentChatId ? chatSources[key] : undefined;
  const isTelegram = source === 'telegram';

  return (
    <Box
      sx={{
        width: 240,
        bgcolor: '#fff',
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase' }} color="text.secondary">
          Информация
        </Typography>
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Клиент: <Box component="span" sx={{ color: 'text.primary' }}>{clientName || '—'}</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Канал: <Box component="span" sx={{ color: 'text.primary' }}>{isTelegram ? 'Telegram' : 'Виджет'}</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Оператор: <Box component="span" sx={{ color: 'text.primary' }}>{assignee?.name || 'Не назначен'}</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ID чата: <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{publicCode}</Box>
          </Typography>
        </Box>
      </Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase' }} color="text.secondary">
          Шаблоны
        </Typography>
        <Box sx={{ mt: 1 }}>
          {cannedResponses.slice(0, 8).map((t) => (
            <Box
              key={t.id}
              onClick={() => onInsertTemplate?.(t.content)}
              title="Вставить шаблон"
              sx={{
                p: 0.75,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                mb: 0.5,
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
                '&:hover': { bgcolor: '#eff6ff', borderColor: 'primary.main' },
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{t.title}</Typography>
              <Typography variant="caption" color="text.secondary">/{t.shortcut}</Typography>
            </Box>
          ))}
          {cannedResponses.length === 0 && (
            <Typography variant="caption" color="text.secondary">Нет шаблонов</Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}