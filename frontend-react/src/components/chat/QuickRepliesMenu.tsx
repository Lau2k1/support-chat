import { useState } from 'react';
import {
  Box,
  Typography,
  Popover,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Button,
  IconButton,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { useChatStore } from '@/stores/chatStore';

interface QuickRepliesMenuProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  /** Inserts the picked answer into the chat input. */
  onInsert: (content: string) => void;
  /** Opens the "add your own answer" management dialog. */
  onManage: () => void;
}

const NO_CATEGORY = 'Без категории';

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'ответ';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'ответа';
  return 'ответов';
}

export default function QuickRepliesMenu({ open, anchorEl, onClose, onInsert, onManage }: QuickRepliesMenuProps) {
  const { cannedResponses } = useChatStore();
  const [category, setCategory] = useState<string | null>(null);

  const categories = [...new Set(cannedResponses.map((r) => r.category || ''))].sort((a, b) => {
    const ae = a === '' ? 1 : 0;
    const be = b === '' ? 1 : 0;
    if (ae !== be) return ae - be;
    return a.localeCompare(b, 'ru');
  });

  const options = category === null ? [] : cannedResponses.filter((r) => (r.category || '') === category);
  const labelOf = (c: string) => (c === '' ? NO_CATEGORY : c);

  const handleClose = () => {
    setCategory(null);
    onClose();
  };

  const handlePick = (content: string) => {
    onInsert(content);
    handleClose();
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width: 380,
            maxWidth: 'calc(100vw - 16px)',
            borderRadius: 2,
            boxShadow: '0 4px 24px rgba(30, 41, 59, 0.12)',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 420 }}>
        <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase' }} color="text.secondary">
            Быстрые ответы
          </Typography>
          <Typography variant="caption" color="text.secondary">{category !== null ? labelOf(category) : `${categories.length} категорий`}</Typography>
        </Box>

        {category !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <IconButton size="small" onClick={() => setCategory(null)} title="Назад">
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {labelOf(category)}
            </Typography>
          </Box>
        )}

        <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 120 }}>
          {category === null ? (
            cannedResponses.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2.5, textAlign: 'center' }}>
                Нет быстрых ответов. Добавьте свой — он появится здесь.
              </Typography>
            ) : (
              <List dense disablePadding>
                {categories.map((c) => {
                  const count = cannedResponses.filter((r) => (r.category || '') === c).length;
                  return (
                    <ListItemButton
                      key={c}
                      onClick={() => setCategory(c)}
                      sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: '#f1f5f9', '&:hover': { bgcolor: '#f5f7f9' } }}
                    >
                      <ListItemText
                        primary={<Typography variant="body2" sx={{ fontWeight: 500 }}>{labelOf(c)}</Typography>}
                        secondary={<Typography variant="caption" color="text.secondary">{count} {plural(count)}</Typography>}
                      />
                      <ChevronRightIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                    </ListItemButton>
                  );
                })}
              </List>
            )
          ) : (
            <List dense disablePadding>
              {options.map((r) => (
                <ListItemButton
                  key={r.id}
                  onClick={() => handlePick(r.content)}
                  sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: '#f1f5f9', alignItems: 'flex-start', '&:hover': { bgcolor: '#f5f7f9' } }}
                >
                  <ListItemText
                    primary={<Typography variant="body2" sx={{ fontWeight: 600 }}>{r.title}</Typography>}
                    secondary={
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          whiteSpace: 'normal',
                        }}
                      >
                        {r.content}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        <Divider />
        <Box sx={{ px: 1, py: 1 }}>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              handleClose();
              onManage();
            }}
          >
            Добавить свой ответ
          </Button>
        </Box>
      </Box>
    </Popover>
  );
}