import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { TicketField } from '@/types';

interface Props {
  fields: TicketField[];
  values: Record<string, any>;
  onChange: (fieldId: string, value: any) => void;
  disabled?: boolean;
}

function labelOf(f: TicketField): string {
  return f.label + (f.required ? ' *' : '');
}

/**
 * Renders a ticket template schema as a fillable form.
 * Layout-only fields (title/divider) are rendered as static structure.
 */
export default function TemplateFormRenderer({ fields, values, onChange, disabled = false }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {fields.map((f) => {
        if (f.type === 'divider') return <Divider key={f.id} sx={{ my: 1 }} />;

        if (f.type === 'title') {
          return (
            <Typography key={f.id} variant="subtitle1" sx={{ fontWeight: 700, mt: 1 }}>
              {f.label}
            </Typography>
          );
        }

        const value = values[f.id];
        const label = labelOf(f);
        const options = f.options || [];

        let control: React.ReactNode;

        switch (f.type) {
          case 'textarea':
            control = (
              <TextField
                multiline
                rows={4}
                fullWidth
                label={label}
                value={value ?? ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={disabled}
              />
            );
            break;

          case 'number':
            control = (
              <TextField
                type="number"
                fullWidth
                label={label}
                value={value ?? ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={disabled}
              />
            );
            break;

          case 'date':
            control = (
              <TextField
                type="date"
                fullWidth
                label={label}
                value={value ?? ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={disabled}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            );
            break;

          case 'select':
            control = (
              <FormControl fullWidth>
                <InputLabel>{label}</InputLabel>
                <Select
                  label={label}
                  value={value ?? ''}
                  onChange={(e) => onChange(f.id, e.target.value)}
                  disabled={disabled}
                >
                  <MenuItem value="">
                    <em>Не выбрано</em>
                  </MenuItem>
                  {options.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
            break;

          case 'multiselect':
            control = (
              <FormControl fullWidth>
                <InputLabel>{label}</InputLabel>
                <Select
                  multiple
                  label={label}
                  value={Array.isArray(value) ? value : []}
                  onChange={(e) => onChange(f.id, e.target.value)}
                  disabled={disabled}
                  renderValue={(selected) =>
                    (selected as string[])
                      .map((v) => options.find((o) => o.value === v)?.label ?? v)
                      .join(', ')
                  }
                >
                  {options.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
            break;

          case 'radio':
            control = (
              <FormControl>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {label}
                </Typography>
                <RadioGroup value={value ?? ''} onChange={(e) => onChange(f.id, e.target.value)}>
                  {options.map((o) => (
                    <FormControlLabel
                      key={o.value}
                      value={o.value}
                      control={<Radio />}
                      label={o.label}
                      disabled={disabled}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
            );
            break;

          case 'checkbox': {
            if (options.length === 0) {
              control = (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={!!value}
                      onChange={(e) => onChange(f.id, e.target.checked)}
                      disabled={disabled}
                    />
                  }
                  label={label}
                />
              );
            } else {
              const selected: string[] = Array.isArray(value) ? value : [];
              control = (
                <FormControl>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {label}
                  </Typography>
                  <FormGroup>
                    {options.map((o) => (
                      <FormControlLabel
                        key={o.value}
                        control={
                          <Checkbox
                            checked={selected.includes(o.value)}
                            onChange={(e) =>
                              onChange(
                                f.id,
                                e.target.checked
                                  ? [...selected, o.value]
                                  : selected.filter((x) => x !== o.value)
                              )
                            }
                            disabled={disabled}
                          />
                        }
                        label={o.label}
                      />
                    ))}
                  </FormGroup>
                </FormControl>
              );
            }
            break;
          }

          case 'file':
            control = (
              <TextField
                fullWidth
                label={label}
                placeholder="https://..."
                value={value ?? ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={disabled}
              />
            );
            break;

          default:
            control = (
              <TextField
                fullWidth
                label={label}
                value={value ?? ''}
                onChange={(e) => onChange(f.id, e.target.value)}
                disabled={disabled}
              />
            );
        }

        return (
          <Box key={f.id}>
            {control}
            {f.helpText && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                {f.helpText}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
