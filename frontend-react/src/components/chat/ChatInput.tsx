import { useState, useRef, useImperativeHandle } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Button,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import NoteIcon from '@mui/icons-material/Note';
import QuickreplyIcon from '@mui/icons-material/Quickreply';
import LabelIcon from '@mui/icons-material/Label';
import { useChatStore } from '@/stores/chatStore';
import { wsManager } from '@/services/ws';
import { chatApi } from '@/services/endpoints';
import { useTyping } from '@/hooks/useTyping';
import { useUIStore } from '@/stores/uiStore';

export interface ChatInputApi {
  /** Append a canned-response template to the input and focus it. */
  insertTemplate: (content: string) => void;
}

interface ChatInputProps {
  chatId: number | null;
  onOpenTemplates: () => void;
  onOpenTagSelector: () => void;
  /** Imperative handle used to insert templates without touching the DOM. */
  apiRef?: React.Ref<ChatInputApi> | null;
}

export default function ChatInput({ chatId, onOpenTemplates, onOpenTagSelector, apiRef }: ChatInputProps) {
  const [text, setText] = useState('');
  const { noteMode, setNoteMode, cannedResponses } = useChatStore();
  const { handleTyping, stopTyping } = useTyping();
  const showToast = useUIStore((s) => s.showToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(apiRef, () => ({
    insertTemplate: (content: string) => {
      setText((prev) => (prev ? `${prev}\n${content}` : content));
      // Focus once the update is applied (input is controlled by `text`).
      window.setTimeout(() => textInputRef.current?.focus(), 0);
    },
  }));

  const handleSend = () => {
    if (!text.trim() || !chatId) return;

    if (noteMode) {
      wsManager.send({ type: 'message', chatId, content: text.trim(), message_type: 'note' });
    } else {
      wsManager.send({ type: 'message', chatId, content: text.trim() });
    }
    setText('');
    stopTyping(chatId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === 'Tab' && text.startsWith('/')) {
      e.preventDefault();
      const shortcut = text.slice(1);
      const match = cannedResponses.find(
        (c) => c.shortcut.toLowerCase() === shortcut.toLowerCase()
      );
      if (match) {
        setText(match.content);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    try {
      await chatApi.uploadFile(chatId, file);
    } catch {
      showToast('Ошибка загрузки файла', 'error');
    }
    e.target.value = '';
  };

  const disabled = !chatId;

  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: '#fff',
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} hidden accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt" />

      <ToggleButtonGroup size="small" value={noteMode ? 'note' : ''} exclusive>
        <ToggleButton
          value="note"
          size="small"
          selected={noteMode}
          onClick={() => setNoteMode(!noteMode)}
          sx={{ px: 1, fontSize: 12, fontWeight: 600, border: '1px solid', borderColor: 'divider' }}
        >
          <NoteIcon sx={{ fontSize: 14, mr: 0.5 }} />
          Заметка
        </ToggleButton>
      </ToggleButtonGroup>

      <IconButton size="small" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
        <AttachFileIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={onOpenTemplates} disabled={disabled}>
        <QuickreplyIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={onOpenTagSelector} disabled={disabled}>
        <LabelIcon fontSize="small" />
      </IconButton>

      <TextField
        fullWidth
        size="small"
        placeholder={noteMode ? 'Внутренняя заметка...' : 'Сообщение... (/ для шаблонов)'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (chatId) handleTyping(chatId);
        }}
        onKeyDown={handleKeyDown}
        inputRef={textInputRef}
        disabled={disabled}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
      />

      <Button
        variant="contained"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        endIcon={<SendIcon />}
        sx={{ flexShrink: 0 }}
      >
        Отправить
      </Button>
    </Box>
  );
}
