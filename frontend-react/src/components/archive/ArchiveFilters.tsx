import { useState, useCallback } from 'react';
import {
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Button,
  Typography,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import type { Tag, ArchiveFilters as Filters } from '@/types';
import { formatDateInput } from '@/utils/format';

interface ArchiveFiltersProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onReset: () => void;
  tags: Tag[];
}

export default function ArchiveFilters({ filters, onChange, onReset, tags }: ArchiveFiltersProps) {
  const [tagSearch, setTagSearch] = useState('');
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);

  const filteredTags = tags.filter((t) =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  const applyDatePreset = useCallback((preset: string) => {
    const today = new Date();
    let from = '';
    let to = '';
    switch (preset) {
      case 'today':
        from = to = formatDateInput(today);
        break;
      case 'yesterday': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        from = to = formatDateInput(y);
        break;
      }
      case 'week': {
        const w = new Date(today);
        w.setDate(w.getDate() - 7);
        from = formatDateInput(w);
        to = formatDateInput(today);
        break;
      }
      case 'month': {
        const m = new Date(today);
        m.setDate(m.getDate() - 30);
        from = formatDateInput(m);
        to = formatDateInput(today);
        break;
      }
    }
    if (from && to) {
      onChange({ ...filters, from, to });
    }
  }, [filters, onChange]);

  const toggleTag = (tagId: number) => {
    const newTagIds = filters.tagIds.includes(tagId)
      ? filters.tagIds.filter((id) => id !== tagId)
      : [...filters.tagIds, tagId];
    onChange({ ...filters, tagIds: newTagIds });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        p: 2.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: '#fff',
        alignItems: 'flex-start',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      }}
    >
      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel>Статус</InputLabel>
        <Select
          value={filters.status}
          label="Статус"
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <MenuItem value="">Все статусы</MenuItem>
          <MenuItem value="open">Открытые</MenuItem>
          <MenuItem value="closed">Закрытые</MenuItem>
        </Select>
      </FormControl>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          type="date"
          label="С"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          type="date"
          label="По"
          value={filters.to}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <FormControl size="small">
          <InputLabel>Пресет</InputLabel>
          <Select
            value=""
            label="Пресет"
            onChange={(e) => applyDatePreset(e.target.value)}
          >
            <MenuItem value="today">Сегодня</MenuItem>
            <MenuItem value="yesterday">Вчера</MenuItem>
            <MenuItem value="week">7 дней</MenuItem>
            <MenuItem value="month">30 дней</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ position: 'relative', minWidth: 200 }}>
        <TextField
          size="small"
          placeholder="Поиск тегов..."
          value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}
          onFocus={() => setTagDropdownOpen(true)}
        />
        {tagDropdownOpen && (
          <Box
            sx={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              bgcolor: '#fff',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              maxHeight: 200,
              overflowY: 'auto',
              zIndex: 1000,
              boxShadow: 2,
            }}
            onMouseLeave={() => setTagDropdownOpen(false)}
          >
            {filteredTags.map((tag) => (
              <FormControlLabel
                key={tag.id}
                control={
                  <Checkbox
                    checked={filters.tagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: tag.color || '#007bff' }} />
                    <Typography variant="body2">{tag.name}</Typography>
                  </Box>
                }
                sx={{ px: 1.5, width: '100%', m: 0 }}
              />
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {filters.tagIds.map((id) => {
            const tag = tags.find((t) => t.id === id);
            if (!tag) return null;
            return (
              <Chip
                key={id}
                label={tag.name}
                size="small"
                onDelete={() => toggleTag(id)}
                sx={{ bgcolor: tag.color || '#007bff', color: '#fff' }}
              />
            );
          })}
        </Box>
      </Box>

      <Button variant="outlined" size="small" onClick={onReset} sx={{ alignSelf: 'flex-end' }}>
        Сбросить
      </Button>
    </Box>
  );
}
