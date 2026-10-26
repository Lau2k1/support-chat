import { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import type {
  ConditionOperator,
  FieldCondition,
  Operator,
  TicketField,
  TicketPriority,
  TemplateAutomation,
} from '@/types';
import { describeCondition, PRIORITY_LABELS } from '@/components/tickets/templateLogic';
import { FIELD_TYPE_LABELS } from './fieldTypes';

export interface TemplateDraft {
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  fields: TicketField[];
  automation: TemplateAutomation;
}

export type EditorTab = 'main' | 'fields' | 'conditions' | 'automation';

interface Props {
  draft: TemplateDraft;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  categories: string[];
  operators: Operator[];
  isNew: boolean;
  saving: boolean;
  dirty: boolean;
  onChange: (patch: Partial<TemplateDraft>) => void;
  onEditField: (index: number) => void;
  onDeleteField: (index: number) => void;
  onMoveField: (index: number, direction: -1 | 1) => void;
  onSave: () => void;
  onCancel: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const EMPTY_CONDITION: FieldCondition = { fieldId: '', operator: 'eq', value: '' };

/** Dialog that edits one field's visibility rule. */
function ConditionDialog({
  open,
  field,
  fields,
  onClose,
  onSave,
}: {
  open: boolean;
  field: TicketField | null;
  fields: TicketField[];
  onClose: () => void;
  onSave: (fieldId: string, condition: FieldCondition | null) => void;
}) {
  const index = field ? fields.findIndex((f) => f.id === field.id) : -1;
  const candidates = index > 0 ? fields.slice(0, index) : [];
  const [condition, setCondition] = useState<FieldCondition>(
    field?.visibleWhen ? { ...field.visibleWhen } : { ...EMPTY_CONDITION }
  );

  const target = candidates.find((f) => f.id === condition.fieldId) || null;
  const targetOptions = target?.options || [];
  const needsValue = condition.operator === 'eq' || condition.operator === 'neq' || condition.operator === 'in';
  const isList = condition.operator === 'in';
  const currentList = Array.isArray(condition.value) ? condition.value : condition.value ? [condition.value] : [];

  const valid = !!condition.fieldId && (!needsValue || currentList.length > 0);

  const resetForTarget = (fieldId: string) => {
    const next = candidates.find((f) => f.id === fieldId) || null;
    const hasOptions = (next?.options?.length || 0) > 0;
    setCondition({
      fieldId,
      operator: hasOptions ? 'eq' : 'notEmpty',
      value: hasOptions ? next!.options![0].value : undefined,
    });
  };

  const changeOperator = (operator: ConditionOperator) => {
    if (operator === 'empty' || operator === 'notEmpty') {
      setCondition((prev) => ({ fieldId: prev.fieldId, operator }));
      return;
    }
    if (operator === 'in') {
      const first = targetOptions[0]?.value;
      setCondition((prev) => ({ fieldId: prev.fieldId, operator, value: first ? [first] : [] }));
      return;
    }
    setCondition((prev) => ({
      fieldId: prev.fieldId,
      operator,
      value: targetOptions[0]?.value || '',
    }));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" disableEnforceFocus>
      <DialogTitle>Условие показа — {field?.label || 'поле'}</DialogTitle>
      <DialogContent dividers>
        {candidates.length === 0 ? (
          <Alert severity="info">
            Условие можно задать только для поля, которое идёт после другого поля. Добавьте поля выше и вернитесь.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <FormControl fullWidth>
              <InputLabel>Зависит от поля</InputLabel>
              <Select
                label="Зависит от поля"
                value={condition.fieldId}
                onChange={(e) => resetForTarget(e.target.value)}
              >
                {candidates.map((f) => (
                  <MenuItem key={f.id} value={f.id}>
                    {f.label || FIELD_TYPE_LABELS[f.type]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth disabled={!condition.fieldId}>
              <InputLabel>Условие</InputLabel>
              <Select
                label="Условие"
                value={condition.operator}
                onChange={(e) => changeOperator(e.target.value as ConditionOperator)}
              >
                <MenuItem value="eq">равно</MenuItem>
                <MenuItem value="neq">не равно</MenuItem>
                <MenuItem value="in" disabled={targetOptions.length === 0}>
                  одно из
                </MenuItem>
                <MenuItem value="notEmpty">заполнено</MenuItem>
                <MenuItem value="empty">пусто</MenuItem>
              </Select>
            </FormControl>

            {needsValue && targetOptions.length > 0 && (
              <FormControl fullWidth>
                <InputLabel>Значение</InputLabel>
                <Select
                  label="Значение"
                  multiple={isList}
                  value={isList ? currentList : (currentList[0] ?? '')}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCondition((prev) => ({
                      ...prev,
                      value: Array.isArray(value) ? value : String(value),
                    }));
                  }}
                >
                  {targetOptions.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {needsValue && targetOptions.length === 0 && (
              <TextField
                label="Значение"
                value={currentList[0] || ''}
                onChange={(e) => setCondition((prev) => ({ ...prev, value: e.target.value }))}
                fullWidth
                helperText="У поля нет вариантов — сравнение идёт с введённым текстом"
              />
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          disabled={!valid || candidates.length === 0}
          onClick={() => field && onSave(field.id, condition)}
        >
          Сохранить условие
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function TemplateEditor({
  draft,
  tab,
  onTabChange,
  categories,
  operators,
  isNew,
  saving,
  dirty,
  onChange,
  onEditField,
  onDeleteField,
  onMoveField,
  onSave,
  onCancel,
  onPreview,
  onDuplicate,
  onDelete,
}: Props) {
  const [conditionField, setConditionField] = useState<TicketField | null>(null);

  const conditionable = useMemo(
    () => draft.fields.filter((f) => f.type !== 'title' && f.type !== 'divider'),
    [draft.fields]
  );
  const activeOperators = useMemo(
    () => operators.filter((o) => o.is_enabled && (o.role === 'operator' || o.role === 'admin')),
    [operators]
  );

  const setCondition = (fieldId: string, condition: FieldCondition | null) => {
    onChange({
      fields: draft.fields.map((f) =>
        f.id === fieldId ? { ...f, visibleWhen: condition || undefined } : f
      ),
    });
    setConditionField(null);
  };

  return (
    <Card sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {isNew ? 'Новый шаблон' : 'Редактирование шаблона'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {dirty ? 'Есть несохранённые изменения' : draft.name || 'Без названия'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Предпросмотр">
              <span>
                <IconButton size="small" onClick={onPreview} disabled={draft.fields.length === 0}>
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Дублировать">
              <span>
                <IconButton size="small" onClick={onDuplicate} disabled={saving || dirty}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Удалить шаблон">
              <span>
                <IconButton size="small" color="error" onClick={onDelete} disabled={saving || dirty}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Tabs
          value={tab}
          onChange={(_, value: EditorTab) => onTabChange(value)}
          variant="fullWidth"
          sx={{ mt: 1, '& .MuiTab-root': { minWidth: 0, px: 0.5, fontSize: 12, letterSpacing: 0 } }}
        >
          <Tab label="Основные" value="main" />
          <Tab label={`Поля (${draft.fields.length})`} value="fields" />
          <Tab
            label={`Условия (${draft.fields.filter((f) => f.visibleWhen).length})`}
            value="conditions"
          />
          <Tab label="Автоматизация" value="automation" />
        </Tabs>
      </Box>

      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
        {tab === 'main' && (
          <Stack spacing={2.5}>
            <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', sm: 'row' } }}>
              <TextField
                label="Название шаблона"
                value={draft.name}
                onChange={(e) => onChange({ name: e.target.value })}
                fullWidth
                required
                autoFocus={isNew}
              />
              <Autocomplete
                freeSolo
                options={categories}
                value={draft.category}
                onInputChange={(_, value) => onChange({ category: value })}
                renderInput={(params) => (
                  <TextField {...params} label="Категория" placeholder="Например, Финансы" />
                )}
                sx={{ minWidth: 220 }}
              />
            </Box>
            <TextField
              label="Описание"
              value={draft.description}
              onChange={(e) => onChange({ description: e.target.value })}
              fullWidth
              multiline
              rows={3}
              placeholder="Что описывает шаблон и когда его использовать"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={draft.isActive}
                  onChange={(e) => onChange({ isActive: e.target.checked })}
                />
              }
              label="Активен (доступен операторам)"
            />
          </Stack>
        )}

        {tab === 'fields' && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Поля шаблона
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Добавляйте поля из панели справа
              </Typography>
            </Box>

            {draft.fields.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                <Typography variant="body2">Пока нет ни одного поля.</Typography>
                <Typography variant="caption">Выберите тип поля в правой колонке.</Typography>
              </Box>
            ) : (
              <List dense sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0 }}>
                {draft.fields.map((f, idx) => (
                  <ListItem
                    key={f.id}
                    divider={idx < draft.fields.length - 1}
                    secondaryAction={
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title="Вверх">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onMoveField(idx, -1)}
                              disabled={idx === 0}
                            >
                              <ArrowUpwardIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Вниз">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onMoveField(idx, 1)}
                              disabled={idx === draft.fields.length - 1}
                            >
                              <ArrowDownwardIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Редактировать">
                          <IconButton size="small" onClick={() => onEditField(idx)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Удалить">
                          <IconButton size="small" color="error" onClick={() => onDeleteField(idx)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {f.label || '(без названия)'}
                          </Typography>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={FIELD_TYPE_LABELS[f.type]}
                            sx={{ height: 20, fontSize: 11 }}
                          />
                          {f.required && (
                            <Typography variant="caption" color="error">
                              *обязательное
                            </Typography>
                          )}
                          {f.visibleWhen && (
                            <Chip
                              size="small"
                              color="info"
                              variant="outlined"
                              label={`если ${describeCondition(f.visibleWhen, draft.fields)}`}
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        f.helpText ? (
                          <Typography variant="caption" color="text.secondary">
                            {f.helpText}
                          </Typography>
                        ) : undefined
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}

        {tab === 'conditions' && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              Поле показывается только тогда, когда выполняется условие по другому полю, которое идёт выше.
              Скрытые поля не проверяются и не сохраняются в тикете.
            </Alert>
            {conditionable.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Сначала добавьте поля во вкладке «Поля».
              </Typography>
            ) : (
              <Stack spacing={1}>
                {conditionable.map((f) => (
                  <Box
                    key={f.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      px: 1.5,
                      py: 1,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {f.label || '(без названия)'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {f.visibleWhen
                          ? `Показывать, если ${describeCondition(f.visibleWhen, draft.fields)}`
                          : 'Показывается всегда'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                      <Button size="small" onClick={() => setConditionField(f)}>
                        {f.visibleWhen ? 'Изменить' : 'Добавить условие'}
                      </Button>
                      {f.visibleWhen && (
                        <IconButton
                          size="small"
                          color="error"
                          title="Убрать условие"
                          onClick={() =>
                            onChange({
                              fields: draft.fields.map((x) =>
                                x.id === f.id ? { ...x, visibleWhen: undefined } : x
                              ),
                            })
                          }
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        )}

        {tab === 'automation' && (
          <Stack spacing={2.5}>
            <Alert severity="info">
              Значения применяются автоматически при создании тикета из этого шаблона. Оператор их не заполняет.
            </Alert>
            <FormControl fullWidth>
              <InputLabel>Приоритет тикета</InputLabel>
              <Select
                label="Приоритет тикета"
                value={draft.automation.priority || ''}
                onChange={(e) =>
                  onChange({
                    automation: {
                      ...draft.automation,
                      priority: (e.target.value || null) as TicketPriority | null,
                    },
                  })
                }
              >
                <MenuItem value="">
                  <em>Не задавать</em>
                </MenuItem>
                {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                  <MenuItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Назначить исполнителя</InputLabel>
              <Select
                label="Назначить исполнителя"
                value={draft.automation.assignTo ?? ''}
                onChange={(e) =>
                  onChange({
                    automation: {
                      ...draft.automation,
                      assignTo: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              >
                <MenuItem value="">
                  <em>Не назначать</em>
                </MenuItem>
                {activeOperators.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.name} ({o.role === 'admin' ? 'админ' : 'оператор'})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Typography variant="caption" color="text.secondary">
              Автоматическое изменение статуса недоступно: у тикета есть только «Не решено» и «Решено»,
              а новый тикет всегда создаётся нерешённым.
            </Typography>
          </Stack>
        )}
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </Box>

      <ConditionDialog
        key={conditionField?.id || 'none'}
        open={!!conditionField}
        field={conditionField}
        fields={draft.fields}
        onClose={() => setConditionField(null)}
        onSave={setCondition}
      />
    </Card>
  );
}
