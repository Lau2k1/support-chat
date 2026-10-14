import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  List,
  ListItem,
  ListItemText,
  Tooltip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import EditIcon from '@mui/icons-material/Edit';
import type { TicketField, TicketFieldType, TicketTemplate, TicketTemplateSchema } from '@/types';

interface TicketTemplateBuilderProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description: string | null; schema: TicketTemplateSchema; isActive: boolean }) => Promise<void>;
  template?: TicketTemplate | null;
  saving?: boolean;
}

const FIELD_TYPES: { value: TicketFieldType; label: string }[] = [
  { value: 'title', label: 'Заголовок/раздел' },
  { value: 'divider', label: 'Разделитель' },
  { value: 'text', label: 'Текст (однострочный)' },
  { value: 'textarea', label: 'Текст (многострочный)' },
  { value: 'number', label: 'Число' },
  { value: 'date', label: 'Дата' },
  { value: 'select', label: 'Выпадающий список' },
  { value: 'multiselect', label: 'Множественный выбор' },
  { value: 'radio', label: 'Радио-кнопки' },
  { value: 'checkbox', label: 'Чекбоксы' },
  { value: 'file', label: 'Файл' },
];

function createFieldId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export default function TicketTemplateBuilder({
  open,
  onClose,
  onSave,
  template,
  saving = false,
}: TicketTemplateBuilderProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [fields, setFields] = useState<TicketField[]>([]);
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [currentField, setCurrentField] = useState<Partial<TicketField>>({ type: 'text', label: '', required: false });

  useEffect(() => {
    if (open) {
      if (template) {
        setName(template.name || '');
        setDescription(template.description || '');
        setIsActive(template.is_active);
        const cloned = Array.isArray(template.schema?.fields)
          ? template.schema.fields.map((f) => ({ ...f }))
          : [];
        setFields(cloned);
      } else {
        setName('');
        setDescription('');
        setIsActive(true);
        setFields([]);
      }
      setEditingIndex(null);
      setFieldDialogOpen(false);
    }
  }, [open, template]);

  const openNewField = () => {
    setEditingIndex(null);
    setCurrentField({ id: createFieldId(), type: 'text', label: '', required: false, options: [], helpText: '', placeholder: '' });
    setFieldDialogOpen(true);
  };

  const openEditField = (index: number) => {
    const f = fields[index];
    setEditingIndex(index);
    setCurrentField({ ...f, options: f.options ? f.options.map((o) => ({ ...o })) : [] });
    setFieldDialogOpen(true);
  };

  const moveField = (index: number, dir: -1 | 1) => {
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    setFields(next.map((f, i) => ({ ...f, order: i })));
  };

  const deleteField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })));
  };

  const saveField = () => {
    if (!currentField.label?.trim() && currentField.type !== 'divider') {
      if (currentField.type !== 'title' && currentField.type !== 'divider') return;
    }
    const field: TicketField = {
      id: currentField.id || createFieldId(),
      type: (currentField.type as TicketFieldType) || 'text',
      label: currentField.label?.trim() || '',
      placeholder: currentField.placeholder?.trim() || undefined,
      required: !!currentField.required,
      options: Array.isArray(currentField.options) ? currentField.options.filter((o) => o.value && o.label) : undefined,
      helpText: currentField.helpText?.trim() || undefined,
      order: fields.length,
      defaultValue: currentField.defaultValue,
    };

    if (editingIndex === null) {
      setFields((prev) => [...prev, { ...field, order: prev.length }]);
    } else {
      setFields((prev) =>
        prev.map((f, i) => (i === editingIndex ? { ...field, order: i } : { ...f, order: i }))
      );
    }
    setFieldDialogOpen(false);
  };

  const addOption = () => {
    setCurrentField((prev) => ({
      ...prev,
      options: [...(prev.options || []), { value: '', label: '' }],
    }));
  };

  const updateOption = (idx: number, key: 'value' | 'label', val: string) => {
    setCurrentField((prev) => {
      const opts = [...(prev.options || [])];
      opts[idx] = { ...opts[idx], [key]: val };
      return { ...prev, options: opts };
    });
  };

  const removeOption = (idx: number) => {
    setCurrentField((prev) => {
      const opts = [...(prev.options || [])];
      opts.splice(idx, 1);
      return { ...prev, options: opts };
    });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const schema: TicketTemplateSchema = {
      fields: fields.map((f, i) => ({ ...f, order: i })),
    };
    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      schema,
      isActive,
    });
  };

  const needsOptions = ['select', 'multiselect', 'radio', 'checkbox'].includes(currentField.type || '');

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" disableEnforceFocus>
        <DialogTitle>{template ? 'Редактировать шаблон тикета' : 'Создать шаблон тикета'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <TextField
              label="Название шаблона"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              autoFocus
            />
            <TextField
              label="Описание (необязательно)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
            <FormControlLabel
              control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
              label="Шаблон активен (доступен операторам)"
            />

            <Divider />

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Поля шаблона
              </Typography>
              <Button startIcon={<AddIcon />} onClick={openNewField} variant="outlined" size="small">
                Добавить поле
              </Button>
            </Box>

            {fields.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                Поля ещё не добавлены. Нажмите «Добавить поле», чтобы собрать форму.
              </Typography>
            ) : (
              <List dense sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0 }}>
                {fields.map((f, idx) => (
                  <ListItem
                    key={f.id}
                    divider={idx < fields.length - 1}
                    secondaryAction={
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Вверх">
                          <span>
                            <IconButton size="small" onClick={() => moveField(idx, -1)} disabled={idx === 0}>
                              <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Вниз">
                          <span>
                            <IconButton size="small" onClick={() => moveField(idx, 1)} disabled={idx === fields.length - 1}>
                              <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Редактировать">
                          <IconButton size="small" onClick={() => openEditField(idx)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Удалить">
                          <IconButton size="small" color="error" onClick={() => deleteField(idx)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {f.label || '(Без названия)'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            [{FIELD_TYPES.find((t) => t.value === f.type)?.label || f.type}]
                          </Typography>
                          {f.required && (
                            <Typography variant="caption" color="error">
                              *обязательное
                            </Typography>
                          )}
                        </Box>
                      }
                      secondary={
                        (f.placeholder || f.helpText || (needsOptions && f.options?.length)) && (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {f.placeholder && `Плейсхолдер: ${f.placeholder}`}
                            {f.placeholder && f.helpText && ' • '}
                            {f.helpText}
                            {f.options?.length ? ` • Вариантов: ${f.options.length}` : ''}
                          </Typography>
                        )
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={saving || !name.trim()}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog for field editor */}
      <Dialog open={fieldDialogOpen} onClose={() => setFieldDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingIndex === null ? 'Добавить поле' : 'Редактировать поле'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <FormControl fullWidth required>
              <InputLabel>Тип поля</InputLabel>
              <Select
                label="Тип поля"
                value={currentField.type || 'text'}
                onChange={(e) => setCurrentField((prev) => ({ ...prev, type: e.target.value as TicketFieldType }))}
              >
                {FIELD_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {currentField.type !== 'divider' && (
              <TextField
                label="Название поля (лейбл)"
                value={currentField.label || ''}
                onChange={(e) => setCurrentField((prev) => ({ ...prev, label: e.target.value }))}
                fullWidth
                required
              />
            )}

            {['text', 'textarea', 'number'].includes(currentField.type || '') && (
              <TextField
                label="Плейсхолдер"
                value={currentField.placeholder || ''}
                onChange={(e) => setCurrentField((prev) => ({ ...prev, placeholder: e.target.value }))}
                fullWidth
              />
            )}

            {currentField.type !== 'divider' && currentField.type !== 'title' && (
              <FormControlLabel
                control={
                  <Switch
                    checked={!!currentField.required}
                    onChange={(e) => setCurrentField((prev) => ({ ...prev, required: e.target.checked }))}
                  />
                }
                label="Обязательное поле"
              />
            )}

            <TextField
              label="Подсказка (helpText)"
              value={currentField.helpText || ''}
              onChange={(e) => setCurrentField((prev) => ({ ...prev, helpText: e.target.value }))}
              fullWidth
              multiline
              rows={1}
            />

            {needsOptions && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle2">Варианты ответа</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addOption}>
                    Добавить вариант
                  </Button>
                </Box>
                <Stack spacing={1}>
                  {(currentField.options || []).map((opt, idx) => (
                    <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="Значение"
                        value={opt.value}
                        onChange={(e) => updateOption(idx, 'value', e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        label="Текст"
                        value={opt.label}
                        onChange={(e) => updateOption(idx, 'label', e.target.value)}
                        sx={{ flex: 1 }}
                      />
                      <IconButton size="small" color="error" onClick={() => removeOption(idx)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                  {(currentField.options || []).length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Добавьте хотя бы один вариант
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldDialogOpen(false)}>Отмена</Button>
          <Button onClick={saveField} variant="contained">
            Готово
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
