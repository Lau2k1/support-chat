import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { TicketField, TicketFieldOption, TicketFieldType } from '@/types';
import { createFieldId, FIELD_TYPE_LABELS, isLayoutType, OPTION_TYPES } from './fieldTypes';

interface Props {
  open: boolean;
  initialType?: TicketFieldType;
  field?: TicketField | null;
  existingIds?: string[];
  onClose: () => void;
  onSave: (field: TicketField) => void;
}

const EMPTY_OPTION: TicketFieldOption = { value: '', label: '' };

export default function FieldEditorDialog({
  open,
  initialType = 'text',
  field,
  existingIds = [],
  onClose,
  onSave,
}: Props) {
  const [type, setType] = useState<TicketFieldType>(initialType);
  const [label, setLabel] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [helpText, setHelpText] = useState('');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<TicketFieldOption[]>([]);

  useEffect(() => {
    if (!open) return;
    setType(field?.type || initialType);
    setLabel(field?.label || '');
    setPlaceholder(field?.placeholder || '');
    setHelpText(field?.helpText || '');
    setRequired(!!field?.required);
    setOptions(field?.options?.length ? field.options.map((o) => ({ ...o })) : []);
  }, [open, field, initialType]);

  const layout = isLayoutType(type);
  const needsOptions = OPTION_TYPES.includes(type);

  const valid =
    (layout || label.trim().length > 0) &&
    (!needsOptions || (options.length > 0 && options.every((o) => o.value.trim() && o.label.trim())));

  const handleSave = () => {
    if (!valid) return;
    const base: TicketField = {
      id: field?.id || createFieldId(),
      type,
      label: label.trim(),
      required: layout ? false : required,
      order: field?.order,
    };
    if (!layout) {
      if (placeholder.trim()) base.placeholder = placeholder.trim();
      if (helpText.trim()) base.helpText = helpText.trim();
    }
    if (needsOptions) {
      base.options = options
        .map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
        .filter((o) => o.value && o.label);
    }
    // Keep a previously configured visibility rule, and keep its id stable.
    if (field?.visibleWhen) base.visibleWhen = field.visibleWhen;
    if (field?.defaultValue !== undefined) base.defaultValue = field.defaultValue;
    // A brand-new field must not reuse an id already present in the template.
    if (!field && existingIds.includes(base.id)) base.id = createFieldId();
    onSave(base);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" disableEnforceFocus>
      <DialogTitle>{field ? 'Редактировать поле' : 'Добавить поле'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <FormControl fullWidth>
            <InputLabel>Тип поля</InputLabel>
            <Select
              label="Тип поля"
              value={type}
              onChange={(e) => setType(e.target.value as TicketFieldType)}
            >
              {(Object.keys(FIELD_TYPE_LABELS) as TicketFieldType[]).map((t) => (
                <MenuItem key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label={layout ? 'Текст заголовка' : 'Название поля'}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            fullWidth
            required={!layout}
            autoFocus
          />

          {!layout && ['text', 'textarea', 'number'].includes(type) && (
            <TextField
              label="Плейсхолдер"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              fullWidth
            />
          )}

          {!layout && (
            <FormControlLabel
              control={<Switch checked={required} onChange={(e) => setRequired(e.target.checked)} />}
              label="Обязательное поле"
            />
          )}

          <TextField
            label="Подсказка под полем"
            value={helpText}
            onChange={(e) => setHelpText(e.target.value)}
            fullWidth
            multiline
            rows={1}
          />

          {needsOptions && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">Варианты ответа</Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setOptions((prev) => [...prev, { ...EMPTY_OPTION }])}
                >
                  Добавить
                </Button>
              </Box>
              <Stack spacing={1}>
                {options.map((opt, idx) => (
                  <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                      size="small"
                      label="Значение"
                      value={opt.value}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, value: e.target.value } : o))
                        )
                      }
                      sx={{ flex: 1 }}
                    />
                    <TextField
                      size="small"
                      label="Текст"
                      value={opt.label}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === idx ? { ...o, label: e.target.value } : o))
                        )
                      }
                      sx={{ flex: 1 }}
                    />
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label="Удалить вариант"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
                {options.length === 0 && (
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
        <Button onClick={onClose}>Отмена</Button>
        <Button onClick={handleSave} variant="contained" disabled={!valid}>
          {field ? 'Сохранить' : 'Добавить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
