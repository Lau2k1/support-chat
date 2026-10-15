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
import { LIMITS } from '@/utils/validation';
import { UPLOAD_ACCEPT, uploadSizeError } from '@/utils/upload';
import { imageFilesFromClipboard } from '@/utils/clipboard';
import QuickRepliesMenu from '@/components/chat/QuickRepliesMenu';

export interface ChatInputApi {
  /** Append a canned-response template to the input and focus it. */
  insertTemplate: (content: string) => void;
}

interface ChatInputProps {
  chatId: number | null;
  onOpenTemplates: () => void;
  onOpenTagSelector: () => void;
  /** Read-only mode (observing another operator's chat): sending is disabled. */
  readOnly?: boolean;
  /** Imperative handle used to insert templates without touching the DOM. */
  apiRef?: React.Ref<ChatInputApi> | null;
}

export default function ChatInput({ chatId, onOpenTemplates, onOpenTagSelector, readOnly, apiRef }: ChatInputProps) {
  const [text, setText] = useState('');
  const [quickAnchor, setQuickAnchor] = useState<HTMLElement | null>(null);
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

  const insertQuick = (content: string) => {
    setText((prev) => (prev ? `${prev}\n${content}` : content));
    window.setTimeout(() => textInputRef.current?.focus(), 0);
  };

  const handleSend = () => {
    if (!text.trim() || !chatId) return;
    if (text.trim().length > LIMITS.message) {
      showToast(`Сообщение слишком длинное (максимум ${LIMITS.message} символов)`, 'error');
      return;
    }

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
    const sizeErr = uploadSizeError(file);
    if (sizeErr) {
      showToast(sizeErr, 'error');
      e.target.value = '';
      return;
    }
    try {
      await chatApi.uploadFile(chatId, file);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Ошибка загрузки файла', 'error');
    }
    e.target.value = '';
  };

  // Ctrl+V: paste image(s) straight from the clipboard into the chat.
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (!chatId || readOnly) return;
    const files = imageFilesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) {
      const sizeErr = uploadSizeError(file);
      if (sizeErr) {
        showToast(sizeErr, 'error');
        continue;
      }
      try {
        await chatApi.uploadFile(chatId, file);
      } catch (err: any) {
        showToast(err?.response?.data?.error || 'Ошибка загрузки изображения', 'error');
      }
    }
  };

  const disabled = !chatId || readOnly;
  const placeholder = readOnly ? 'Режим наблюдения — отправка недоступна' : noteMode ? 'Внутренняя заметка...' : 'Сообщение... (/ для быстрых ответов)';

  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        hidden
        accept={UPLOAD_ACCEPT}
      />

      <ToggleButtonGroup size="small" value={noteMode ? 'note' : ''} exclusive disabled={disabled}>
        <ToggleButton
          value="note"
          size="small"
          selected={noteMode}
          disabled={disabled}
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
      <IconButton size="small" onClick={(e) => setQuickAnchor(e.currentTarget)} disabled={disabled} title="Быстрые ответы">
        <QuickreplyIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={onOpenTagSelector} disabled={disabled}>
        <LabelIcon fontSize="small" />
      </IconButton>

      <TextField
        fullWidth
        size="small"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (chatId) handleTyping(chatId);
        }}
        onKeyDown={handleKeyDown}
        inputRef={textInputRef}
        disabled={disabled}
        slotProps={{ htmlInput: { maxLength: LIMITS.message, onPaste: handlePaste } }}
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

      <QuickRepliesMenu
        open={Boolean(quickAnchor)}
        anchorEl={quickAnchor}
        onClose={() => setQuickAnchor(null)}
        onInsert={insertQuick}
        onManage={() => {
          setQuickAnchor(null);
          onOpenTemplates();
        }}
      />
    </Box>
  );
}
