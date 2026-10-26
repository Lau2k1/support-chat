import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { ticketsApi, ticketTemplatesApi } from '@/services/endpoints';
import type { Ticket, TicketPriority, TicketTemplate } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import TemplateFormRenderer from './TemplateFormRenderer';
import { PRIORITY_LABELS, requiredFieldError, visibleFields, fieldsLabel } from './templateLogic';

export type CreateMode = 'template' | 'free';

interface Props {
  open: boolean;
  mode: CreateMode;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}

const TEMPLATE_STEPS = ['Выбор шаблона', 'Заполнение формы', 'Создание тикета'];
const FREE_STEPS = ['Данные обращения', 'Создание тикета'];

export default function CreateTicketDialog({ open, mode, onClose, onCreated }: Props) {
  const showToast = useUIStore((s) => s.showToast);

  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSearch('');
    setSelectedId(null);
    setValues({});
    setSubject('');
    setDescription('');
    setPriority('normal');
    setError(null);
    setSaving(false);
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== 'template') return;
    let cancelled = false;
    setLoading(true);
    ticketTemplatesApi
      .list()
      .then(({ data }) => {
        if (!cancelled) setTemplates((data.items || []).filter((t) => t.is_active));
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.response?.data?.error || 'Не удалось загрузить шаблоны');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
    );
  }, [templates, search]);

  const steps = mode === 'template' ? TEMPLATE_STEPS : FREE_STEPS;

  const goNext = () => {
    setError(null);
    if (mode === 'template') {
      if (step === 0) {
        if (!selected) {
          setError('Выберите шаблон тикета');
          return;
        }
        setStep(1);
        return;
      }
      if (step === 1 && selected) {
        const missing = requiredFieldError(selected.schema?.fields || [], values);
        if (missing) {
          setError(missing);
          return;
        }
        setStep(2);
        return;
      }
    } else {
      if (step === 0) {
        const trimmed = subject.trim();
        if (trimmed.length < 3) {
          setError('Укажите тему обращения (минимум 3 символа)');
          return;
        }
        if (trimmed.length > 150) {
          setError('Тема: максимум 150 символов');
          return;
        }
        if (description.length > 5000) {
          setError('Описание: максимум 5000 символов');
          return;
        }
        setStep(1);
      }
    }
  };

  const goBack = () => {
    setError(null);
    setStep((prev) => Math.max(0, prev - 1));
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } =
        mode === 'template' && selected
          ? await ticketsApi.create({ mode: 'template', templateId: selected.id, data: values })
          : await ticketsApi.create({
              mode: 'free',
              subject: subject.trim(),
              description: description.trim(),
              priority,
            });
      showToast(`Тикет #${data.ticket.id} создан`);
      onCreated(data.ticket);
      onClose();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Не удалось создать тикет');
    } finally {
      setSaving(false);
    }
  };

  const automation = selected?.schema?.automation;

  const summaryRows = useMemo(() => {
    if (mode !== 'template' || !selected) return [];
    return visibleFields(selected.schema?.fields || [], values)
      .filter((f) => f.type !== 'title' && f.type !== 'divider')
      .map((f) => {
        const raw = values[f.id];
        if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
          return null;
        }
        const text = Array.isArray(raw)
          ? raw
              .map((v) => f.options?.find((o) => o.value === v)?.label ?? String(v))
              .join(', ')
          : f.options?.find((o) => o.value === String(raw))?.label ?? String(raw);
        return { label: f.label, value: text };
      })
      .filter((row): row is { label: string; value: string } => !!row);
  }, [mode, selected, values]);

  const canCreate = mode === 'template' ? !!selected : subject.trim().length >= 3;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{mode === 'template' ? 'Создать тикет из шаблона' : 'Свободный тикет'}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {mode === 'template' && step === 0 && (
          <Box>
            <TextField
              size="small"
              fullWidth
              placeholder="Поиск шаблона"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ mb: 2 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress size={28} />
              </Box>
            ) : filtered.length === 0 ? (
              <Alert severity="info">
                {templates.length === 0
                  ? 'Администратор ещё не создал активных шаблонов. Используйте «Свободный тикет».'
                  : 'Ничего не найдено'}
              </Alert>
            ) : (
              <List
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, maxHeight: 380, overflowY: 'auto' }}
              >
                {filtered.map((tpl) => (
                  <ListItemButton
                    key={tpl.id}
                    selected={tpl.id === selectedId}
                    onClick={() => setSelectedId(tpl.id)}
                    divider
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {tpl.name}
                          </Typography>
                          {tpl.category && (
                            <Chip size="small" label={tpl.category} variant="outlined" sx={{ height: 20 }} />
                          )}
                          <Typography variant="caption" color="text.secondary">
                            {fieldsLabel(tpl.schema?.fields?.length || 0)}
                          </Typography>
                        </Box>
                      }
                      secondary={tpl.description || undefined}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        )}

        {mode === 'template' && step === 1 && selected && (
          <Box>
            {selected.description && (
              <Alert severity="info" icon={false} sx={{ mb: 2 }}>
                {selected.description}
              </Alert>
            )}
            <TemplateFormRenderer
              fields={selected.schema?.fields || []}
              values={values}
              onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
              disabled={saving}
            />
          </Box>
        )}

        {mode === 'template' && step === 2 && selected && (
          <Box>
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                {selected.name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                {automation?.priority && (
                  <Chip size="small" color="error" label={`Приоритет: ${PRIORITY_LABELS[automation.priority]}`} />
                )}
                {automation?.assignTo && (
                  <Chip size="small" variant="outlined" label="Будет назначен исполнитель" />
                )}
              </Box>
              <Divider sx={{ mb: 2 }} />
              {summaryRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Все поля пустые.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  {summaryRows.map((row) => (
                    <Box key={row.label}>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {row.label}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {row.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Card>
            <Alert severity="info" sx={{ mt: 2 }}>
              После создания тикет появится в списке со статусом «Не решено».
            </Alert>
          </Box>
        )}

        {mode === 'free' && step === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Тема обращения"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              fullWidth
              required
              autoFocus
              helperText="Кратко: с чем обращается клиент"
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />
            <TextField
              label="Описание"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={6}
              placeholder="Что произошло, что уже проверено, что нужно сделать"
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <FormControl fullWidth>
              <InputLabel>Приоритет</InputLabel>
              <Select
                label="Приоритет"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
              >
                {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                  <MenuItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}

        {mode === 'free' && step === 1 && (
          <Box>
            <Card variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {subject.trim()}
                </Typography>
                <Chip size="small" label={PRIORITY_LABELS[priority]} color={priority === 'high' ? 'error' : 'default'} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {description.trim() || 'Без описания'}
              </Typography>
            </Card>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {step > 0 && (
            <Button onClick={goBack} disabled={saving}>
              Назад
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button variant="contained" onClick={goNext} disabled={saving || (mode === 'template' && step === 0 && !selected)}>
              Далее
            </Button>
          ) : (
            <Button variant="contained" onClick={handleCreate} disabled={saving || !canCreate}>
              {saving ? 'Создание…' : 'Создать тикет'}
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
