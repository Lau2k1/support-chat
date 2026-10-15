import { useRef, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useChatStore } from '@/stores/chatStore';
import type { Message } from '@/types';
import { formatTime } from '@/utils/format';

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

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: 'auto',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: 'background.default',
      }}
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {isTyping && (
        <Box sx={{ alignSelf: 'flex-start', px: 1.5, py: 0.8, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 2, fontSize: 13, color: 'text.secondary', fontStyle: 'italic' }}>
          печатает...
        </Box>
      )}
      <div ref={bottomRef} />
    </Box>
  );
}

function MessageBubble({ message: m }: { message: Message }) {
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

  return (
    <Box
      sx={{
        alignSelf: isOperator ? 'flex-end' : 'flex-start',
        maxWidth: '70%',
        px: 1.5,
        py: 1,
        bgcolor: isOperator ? 'primary.main' : 'background.paper',
        color: isOperator ? 'primary.contrastText' : 'text.primary',
        border: isOperator ? 'none' : '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
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
      {(m.message_type === 'text' || (!m.message_type)) && m.content}
      <Typography
        variant="caption"
        sx={{ display: 'block', textAlign: 'right', opacity: 0.6, mt: 0.3 }}
      >
        {formatTime(m.created_at)}
      </Typography>
    </Box>
  );
}
