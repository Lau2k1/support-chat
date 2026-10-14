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
        bgcolor: 'background.paper',
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
          Быстрые ответы
        </Typography>
        <Box sx={{ mt: 1 }}>
          {(() => {
            // Group by category (non-empty first, alphabetically; empty last), cap at 8 items.
            const cats = [...new Set(cannedResponses.map((r) => r.category || ''))].sort((a, b) => {
              const ae = a === '' ? 1 : 0;
              const be = b === '' ? 1 : 0;
              if (ae !== be) return ae - be;
              return a.localeCompare(b, 'ru');
            });
            let shown = 0;
            return cats.map((cat) => {
              if (shown >= 8) return null;
              const items = cannedResponses
                .filter((r) => (r.category || '') === cat)
                .slice(0, 8 - shown);
              shown += items.length;
              if (items.length === 0) return null;
              return (
                <Box key={cat}>
                  <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', display: 'block', mt: 1, mb: 0.5 }} color="text.secondary">
                    {cat === '' ? 'Без категории' : cat}
                  </Typography>
                  {items.map((t) => (
                    <Box
                      key={t.id}
                      onClick={() => onInsertTemplate?.(t.content)}
                      title="Вставить ответ"
                      sx={{
                        p: 0.75,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        mb: 0.5,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                        '&:hover': { bgcolor: 'action.selected', borderColor: 'primary.main' },
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{t.title}</Typography>
                      {t.shortcut && <Typography variant="caption" color="text.secondary">/{t.shortcut}</Typography>}
                    </Box>
                  ))}
                </Box>
              );
            });
          })()}
          {cannedResponses.length === 0 && (
            <Typography variant="caption" color="text.secondary">Нет быстрых ответов</Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}