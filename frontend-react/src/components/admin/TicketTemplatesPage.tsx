import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { adminApi, ticketTemplatesApi } from '@/services/endpoints';
import type { Operator, TicketField, TicketFieldType, TicketTemplate } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import TemplateFormRenderer from '@/components/tickets/TemplateFormRenderer';
import { requiredFieldError, fieldsLabel } from '@/components/tickets/templateLogic';
import FieldEditorDialog from './FieldEditorDialog';
import { FIELD_TYPE_LABELS } from './fieldTypes';
import TemplateEditor, { type EditorTab, type TemplateDraft } from './TemplateEditor';

const EMPTY_DRAFT: TemplateDraft = {
  name: '',
  description: '',
  category: '',
  isActive: true,
  fields: [],
  automation: {},
};

const PALETTE: TicketFieldType[] = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'date',
  'file',
  'title',
  'divider',
];

function toDraft(template: TicketTemplate): TemplateDraft {
  return {
    name: template.name || '',
    description: template.description || '',
    category: template.category || '',
    isActive: template.is_active,
    fields: Array.isArray(template.schema?.fields)
      ? template.schema.fields.map((f, i) => ({ ...f, order: i }))
      : [],
    automation: { ...(template.schema?.automation || {}) },
  };
}

/**
 * Drops conditions that no longer point to an earlier field. Reordering or
 * deleting a field must not leave a rule the server will reject.
 */
function sanitizeConditions(fields: TicketField[]): TicketField[] {
  const seen = new Set<string>();
  return fields.map((f) => {
    let visibleWhen = f.visibleWhen;
    if (visibleWhen && !seen.has(visibleWhen.fieldId)) visibleWhen = undefined;
    seen.add(f.id);
    return { ...f, visibleWhen };
  });
}

export default function TicketTemplatesPage() {
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const [items, setItems] = useState<TicketTemplate[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<EditorTab>('main');

  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; type: TicketFieldType; index: number | null }>({
    open: false,
    type: 'text',
    index: null,
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await ticketTemplatesApi.list();
      setItems(data.items || []);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось загрузить шаблоны', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadOperators = useCallback(async () => {
    try {
      const { data } = await adminApi.getOperators();
      setOperators(Array.isArray(data) ? data : []);
    } catch {
      // Assignee is optional: the editor still works without the list.
      setOperators([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadOperators();
  }, [load, loadOperators]);

  const categories = useMemo(
    () => [...new Set(items.map((t) => t.category?.trim()).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'ru')),
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const patchDraft = (patch: Partial<TemplateDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const applyTemplate = (template: TicketTemplate | null) => {
    if (!template) {
      setSelectedId(null);
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      setTab('main');
    } else {
      setSelectedId(template.id);
      setCreating(false);
      setDraft(toDraft(template));
      setTab('main');
    }
    setDirty(false);
  };

  const withUnsavedCheck = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    showConfirm({
      text: 'В шаблоне есть несохранённые изменения. Перейти и потерять их?',
      confirmLabel: 'Перейти',
      danger: true,
      onConfirm: action,
    });
  };

  const handleSelect = (template: TicketTemplate) => {
    if (template.id === selectedId) return;
    withUnsavedCheck(() => applyTemplate(template));
  };

  const handleCreate = () => {
    withUnsavedCheck(() => {
      applyTemplate(null);
      setCreating(true);
      setTab('main');
    });
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      showToast('Укажите название шаблона', 'error');
      return;
    }
    setSaving(true);
    try {
      const automation = draft.automation || {};
      const hasAutomation = automation.priority != null || automation.assignTo != null;
      const schema = {
        fields: draft.fields.map((f, i) => ({ ...f, order: i })),
        ...(hasAutomation ? { automation } : {}),
      };
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
        isActive: draft.isActive,
        schema,
      };

      if (selectedId === null) {
        const { data } = await ticketTemplatesApi.create(payload);
        showToast('Шаблон создан');
        setSelectedId(data.template.id);
        setCreating(false);
        setDraft(toDraft(data.template));
      } else {
        const { data } = await ticketTemplatesApi.update(selectedId, payload);
        showToast('Шаблон обновлён');
        setDraft(toDraft(data.template));
      }
      setDirty(false);
      await load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось сохранить шаблон', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (selectedId === null) return;
    const template = items.find((t) => t.id === selectedId);
    showConfirm({
      text: `Удалить шаблон «${template?.name || ''}»? Операторы не смогут его использовать, старые тикеты сохранятся.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: async () => {
        try {
          await ticketTemplatesApi.delete(selectedId);
          showToast('Шаблон удалён');
          applyTemplate(null);
          await load();
        } catch (e: any) {
          showToast(e.response?.data?.error || 'Не удалось удалить шаблон', 'error');
        }
      },
    });
  };

  const handleDuplicate = async () => {
    if (selectedId === null) return;
    const template = items.find((t) => t.id === selectedId);
    if (!template) return;
    try {
      const { data } = await ticketTemplatesApi.create({
        name: `${template.name} (копия)`,
        description: template.description,
        category: template.category,
        schema: template.schema,
        isActive: false,
      });
      showToast('Шаблон скопирован (копия неактивна)');
      await load();
      applyTemplate(data.template);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось скопировать шаблон', 'error');
    }
  };

  const saveField = (field: TicketField) => {
    if (fieldDialog.index === null) {
      patchDraft({ fields: [...draft.fields, field] });
      setTab('fields');
    } else {
      const index = fieldDialog.index;
      patchDraft({
        fields: draft.fields.map((f, i) => (i === index ? { ...field, order: i } : f)),
      });
    }
    setFieldDialog((prev) => ({ ...prev, open: false }));
  };

  const removeField = (index: number) => {
    const next = sanitizeConditions(draft.fields.filter((_, i) => i !== index));
    patchDraft({ fields: next });
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const next = [...draft.fields];
    const [item] = next.splice(index, 1);
    next.splice(index + direction, 0, item);
    patchDraft({ fields: sanitizeConditions(next.map((f, i) => ({ ...f, order: i }))) });
  };

  const openNewField = (type: TicketFieldType) => {
    setFieldDialog({ open: true, type, index: null });
  };

  const previewError = requiredFieldError(draft.fields, previewValues);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        alignItems: 'stretch',
        height: 'calc(100vh - 104px)',
        minHeight: 560,
        flexDirection: { xs: 'column', lg: 'row' },
      }}
    >
      {/* ---------- Left: template list ---------- */}
      <Card
        sx={{
          width: { xs: '100%', lg: 260 },
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: { xs: 360, lg: 'none' },
        }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Все шаблоны ({items.length})
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="Поиск шаблона"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mt: 1.5 }}
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
        </Box>
        <Divider />
        <List dense sx={{ flex: 1, overflowY: 'auto', py: 0.5 }}>
          {loading ? (
            <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
              Загрузка…
            </Typography>
          ) : filtered.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
              {items.length === 0 ? 'Шаблонов пока нет' : 'Ничего не найдено'}
            </Typography>
          ) : (
            filtered.map((tpl) => (
              <ListItemButton
                key={tpl.id}
                selected={tpl.id === selectedId}
                onClick={() => handleSelect(tpl)}
                sx={{ alignItems: 'flex-start', py: 1 }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {tpl.name}
                      </Typography>
                      {!tpl.is_active && (
                        <Chip label="выкл" size="small" sx={{ height: 18, fontSize: 10 }} />
                      )}
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {fieldsLabel(tpl.schema?.fields?.length || 0)}
                      {tpl.category ? ` • ${tpl.category}` : ''}
                    </Typography>
                  }
                />
              </ListItemButton>
            ))
          )}
        </List>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Button fullWidth startIcon={<AddIcon />} variant="outlined" onClick={handleCreate}>
            Создать шаблон
          </Button>
        </Box>
      </Card>

      {/* ---------- Middle: editor ---------- */}
      {selectedId === null && !creating ? (
        <Card
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            textAlign: 'center',
          }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Выберите шаблон
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Слева — существующие шаблоны. Или создайте новый: категория, поля, условия показа и автоматизация.
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
              Создать шаблон
            </Button>
          </Box>
        </Card>
      ) : (
        <TemplateEditor
          draft={draft}
          tab={tab}
          onTabChange={setTab}
          categories={categories}
          operators={operators}
          isNew={selectedId === null}
          saving={saving}
          dirty={dirty}
          onChange={patchDraft}
          onEditField={(index) =>
            setFieldDialog({ open: true, type: draft.fields[index].type, index })
          }
          onDeleteField={removeField}
          onMoveField={moveField}
          onSave={handleSave}
          onCancel={() => withUnsavedCheck(() => applyTemplate(selectedId ? items.find((t) => t.id === selectedId) || null : null))}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onPreview={() => {
            setPreviewValues({});
            setPreviewOpen(true);
          }}
        />
      )}

      {/* ---------- Right: field palette ---------- */}
      <Card sx={{ width: { xs: '100%', lg: 240 }, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Поля шаблона
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Нажмите, чтобы добавить поле
          </Typography>
        </Box>
        <Divider />
        <Box sx={{ p: 1, flex: 1, overflowY: 'auto' }}>
          {PALETTE.map((type) => (
            <Button
              key={type}
              fullWidth
              size="small"
              onClick={() => openNewField(type)}
              sx={{ justifyContent: 'flex-start', textTransform: 'none', py: 0.75 }}
              disabled={selectedId === null && !creating && !dirty}
            >
              + {FIELD_TYPE_LABELS[type]}
            </Button>
          ))}
        </Box>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openNewField('text')}
            disabled={selectedId === null && !dirty}
          >
            Добавить поле
          </Button>
        </Box>
      </Card>

      {/* ---------- Field editor ---------- */}
      <FieldEditorDialog
        open={fieldDialog.open}
        initialType={fieldDialog.type}
        field={fieldDialog.index === null ? null : draft.fields[fieldDialog.index]}
        existingIds={draft.fields.map((f) => f.id)}
        onClose={() => setFieldDialog((prev) => ({ ...prev, open: false }))}
        onSave={saveField}
      />

      {/* ---------- Preview ---------- */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Предпросмотр — {draft.name || 'без названия'}</DialogTitle>
        <DialogContent dividers>
          {draft.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {draft.description}
            </Typography>
          )}
          {draft.fields.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Поля отсутствуют
            </Typography>
          ) : (
            <TemplateFormRenderer
              fields={draft.fields}
              values={previewValues}
              onChange={(id, value) => setPreviewValues((prev) => ({ ...prev, [id]: value }))}
            />
          )}
          {previewError && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {previewError} — обязательные поля проверяются при создании тикета.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Actions kept outside the editor header for a compact toolbar */}
    </Box>
  );
}
