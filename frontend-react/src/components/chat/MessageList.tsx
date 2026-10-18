import { useRef, useEffect, Fragment } from 'react';
import { Box, Typography } from '@mui/material';
import { useChatStore } from '@/stores/chatStore';
import type { Message } from '@/types';
import { formatDayLabel, formatTime } from '@/utils/format';
import UserAvatar from '@/components/common/UserAvatar';

interface MessageListProps {
  messages: Message[];
  chatId?: number | null;
}

export default function MessageList({ messages, chatId }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingChatIds = useChatStore((s) => s.typingChatIds);

  const isTyping = chatId != null && typingChatIds.has(chatId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isTyping]);

  // Разделители дней и подпись отправителя считаются от предыдущего сообщения,
  // поэтому состояние живёт в рендере, а не в сторе.
  let lastDay = '';
  let prev: Message | undefined;

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        px: 2,
        py: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        bgcolor: 'background.default',
      }}
    >
      {messages.map((m) => {
        const day = formatDayLabel(m.created_at);
        const isNewDay = day !== lastDay;
        const isNote = m.message_type === 'note';
        // Подряд идущие сообщения одного автора идут одним блоком: имя и аватар
        // печатаются один раз, как в мессенджерах.
        const grouped =
          !isNewDay &&
          !isNote &&
          prev !== undefined &&
          prev.message_type === m.message_type &&
          prev.sender_id === m.sender_id;
        lastDay = day;
        prev = m;

        return (
          <Fragment key={m.id}>
            {isNewDay && day && (
              <Typography
                variant="caption"
                sx={{
                  alignSelf: 'center',
                  color: 'text.secondary',
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 999,
                  px: 1.25,
                  py: 0.25,
                  my: 0.5,
                }}
              >
                {day}
              </Typography>
            )}
            <MessageBubble message={m} showHeader={!grouped} />
          </Fragment>
        );
      })}
      {isTyping && (
        <Box
          sx={{
            alignSelf: 'flex-start',
            px: 1.5,
            py: 0.8,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '14px 14px 14px 4px',
            fontSize: 13,
            color: 'text.secondary',
            fontStyle: 'italic',
          }}
        >
          печатает...
        </Box>
      )}
      <div ref={bottomRef} />
    </Box>
  );
}

function MessageBubble({ message: m, showHeader }: { message: Message; showHeader: boolean }) {
  const isNote = m.message_type === 'note';
  const isClient = m.sender_id === 0;
  const isOperator = !isClient && !isNote;

  if (isNote) {
    return (
      <Box
        sx={{
          alignSelf: 'center',
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          bgcolor: 'warnBg',
          border: '1px dashed',
          borderColor: 'warning.main',
          borderRadius: 2,
          fontSize: 12,
          color: 'warn',
        }}
      >
        📝 {m.content}
      </Box>
    );
  }

  const senderName = m.sender_name || (isClient ? 'Клиент' : 'Оператор');

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isOperator ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 1,
        maxWidth: '80%',
        alignSelf: isOperator ? 'flex-end' : 'flex-start',
      }}
    >
      {showHeader ? (
        <UserAvatar name={isClient ? m.sender_name : senderName} fallback="К" size={28} sx={{ mb: 0.25 }} />
      ) : (
        // Пустая колонка вместо аватара — пузыри одного автора держат одну ось.
        <Box sx={{ width: 28, flexShrink: 0 }} />
      )}

      <Box sx={{ minWidth: 0 }}>
        {showHeader && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mb: 0.25,
              fontWeight: 600,
              color: 'text.secondary',
              textAlign: isOperator ? 'right' : 'left',
            }}
          >
            {senderName}
          </Typography>
        )}
        <Box
          sx={{
            px: 1.5,
            py: 1,
            bgcolor: isOperator ? 'primary.main' : 'background.paper',
            color: isOperator ? 'primary.contrastText' : 'text.primary',
            border: isOperator ? 'none' : '1px solid',
            borderColor: 'divider',
            // «Хвостик» пузыря со стороны отправителя.
            borderRadius: isOperator ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
            fontSize: 14,
            wordBreak: 'break-word',
          }}
        >
          {m.message_type === 'image' && m.file_url && (
            <Box
              component="img"
              src={m.file_url}
              sx={{ maxWidth: 200, borderRadius: 1, cursor: 'pointer' }}
              onClick={() => window.open(m.file_url ?? undefined, '_blank')}
            />
          )}
          {m.message_type === 'video' && m.file_url && (
            <Box
              component="video"
              src={m.file_url}
              controls
              preload="metadata"
              sx={{ maxWidth: 260, width: '100%', borderRadius: 1, display: 'block' }}
            />
          )}
          {m.message_type === 'file' && m.file_url && (
            <a href={m.file_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline', fontSize: 13 }}>
              📎 {m.content || 'Файл'}
            </a>
          )}
          {(m.message_type === 'text' || !m.message_type) && m.content}
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', opacity: 0.6, mt: 0.3 }}>
            {formatTime(m.created_at)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
