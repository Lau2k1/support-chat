import { Box, Typography, Chip, Button } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SendIcon from '@mui/icons-material/Send';
import { useChatStore } from '@/stores/chatStore';
import { formatTime } from '@/utils/format';
import SectionCard from '@/components/common/SectionCard';
import UserAvatar from '@/components/common/UserAvatar';
import { chatLayout } from '@/theme';

interface RightPanelProps {
  /** Inserts a canned response into the message input. */
  onInsertTemplate?: (content: string) => void;
  /** Opens the tag picker for the open chat. */
  onOpenTagSelector?: () => void;
}

export default function RightPanel({ onInsertTemplate, onOpenTagSelector }: RightPanelProps) {
  const { cannedResponses, currentChatId, chatNames, chatPublicCodes, chatAssignees, chatSources, chatTags, messages } =
    useChatStore();
  const key = currentChatId != null ? String(currentChatId) : '';
  const clientName = currentChatId ? chatNames[key] : undefined;
  const publicCode = currentChatId ? (chatPublicCodes[key] || `#${currentChatId}`) : '—';
  const assignee = currentChatId ? chatAssignees[key] : undefined;
  const source = currentChatId ? chatSources[key] : undefined;
  const isTelegram = source === 'telegram';
  const tags = (currentChatId ? chatTags[key] : undefined) || [];
  // Внутренние заметки живут обычными сообщениями с типом 'note'.
  const notes = currentChatId
    ? (messages[key] || []).filter((m) => m.message_type === 'note').slice(-5).reverse()
    : [];

  return (
    <Box
      sx={{
        width: chatLayout.panelWidth,
        bgcolor: 'background.paper',
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      <SectionCard title="Клиент" sx={{ py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <UserAvatar
            name={clientName}
            icon={isTelegram ? <SendIcon sx={{ fontSize: 18 }} /> : undefined}
            size={40}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>
              {clientName || (isTelegram ? 'Telegram' : 'Клиент')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isTelegram ? 'Канал: Telegram' : 'Канал: виджет'}
            </Typography>
          </Box>
        </Box>
      </SectionCard>

      <SectionCard title="Информация">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Оператор: <Box component="span" sx={{ color: 'text.primary' }}>{assignee?.name || 'Не назначен'}</Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ID чата: <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{publicCode}</Box>
          </Typography>
        </Box>
      </SectionCard>

      <SectionCard
        title="Теги"
        action={
          onOpenTagSelector ? (
            <Button size="small" onClick={onOpenTagSelector} sx={{ minWidth: 0, fontSize: 11, py: 0 }}>
              Добавить
            </Button>
          ) : undefined
        }
      >
        {tags.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Тегов нет
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {tags.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                size="small"
                sx={{ height: 22, fontSize: 11, bgcolor: t.color || 'primary.main', color: '#fff' }}
              />
            ))}
          </Box>
        )}
      </SectionCard>

      <SectionCard title="Внутренние заметки">
        {notes.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Заметок нет
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {notes.map((n) => (
              <Box key={n.id} sx={{ p: 1, bgcolor: 'warnBg', borderRadius: 1.5, border: '1px solid', borderColor: 'warning.main' }}>
                <Typography sx={{ fontSize: 12, color: 'warn', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {n.content}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary', fontSize: 10 }}>
                  {n.sender_name || 'Оператор'} · {formatTime(n.created_at)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>

      <SectionCard title="Быстрые ответы" sx={{ borderBottom: 'none' }}>
        {cannedResponses.length === 0 ? (
          <Typography variant="caption" color="text.secondary">Нет быстрых ответов</Typography>
        ) : (
          <Box>
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
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 600, textTransform: 'uppercase', display: 'block', mt: 1, mb: 0.5 }}
                      color="text.secondary"
                    >
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
          </Box>
        )}
      </SectionCard>

      {assignee && (
        <Box sx={{ px: 1.75, py: 1.5, display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
          <VisibilityIcon sx={{ fontSize: 14 }} />
          <Typography variant="caption">Чат закреплён за оператором {assignee.name}</Typography>
        </Box>
      )}
    </Box>
  );
}
