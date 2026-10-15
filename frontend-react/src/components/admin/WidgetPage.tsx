import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { WidgetInfo } from '@/types';

/** Готовый сниппет встраивания: клиент копирует его на сайт без правок. */
function embedSnippet(widgetUrl: string): string {
  return `<iframe
  src="${widgetUrl}"
  title="Чат поддержки"
  style="position:fixed;right:20px;bottom:20px;width:380px;height:620px;border:0;z-index:9999"
></iframe>`;
}

export default function WidgetPage({ tenantId }: { tenantId?: number } = {}) {
  const [info, setInfo] = useState<WidgetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi.getWidget(tenantId);
        setInfo(res.data);
      } catch {
        showToast('Ошибка загрузки данных виджета', 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [showToast, tenantId]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => showToast('Скопировано!'),
      () => showToast('Не удалось скопировать', 'error')
    );
  };

  if (loading) {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Typography color="text.secondary">Загрузка...</Typography>
      </Paper>
    );
  }

  if (!info) {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Typography color="text.secondary">Не удалось загрузить данные виджета</Typography>
      </Paper>
    );
  }

  const snippet = embedSnippet(info.widgetUrl);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 860 }}>
      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 0.5 }}>
          Виджет поддержки на вашем сайте
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Скопируйте код ниже и вставьте его на страницы вашего сайта — в правом нижнем
          углу появится кнопка чата. Сообщения из виджета приходят операторам в эту панель.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 1.5 }}>Код для вставки</Typography>
        <TextField
          value={snippet}
          multiline
          minRows={5}
          fullWidth
          slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12.5 } } }}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
            onClick={() => handleCopy(snippet)}
          >
            Скопировать код
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
            onClick={() => window.open(info.widgetUrl, '_blank')}
          >
            Открыть виджет
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Вставьте код перед закрывающим тегом <b>&lt;/body&gt;</b> на всех страницах, где нужен чат.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 1.5 }}>Ваш код проекта</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={info.slug}
            size="small"
            sx={{ fontFamily: 'monospace', fontWeight: 600 }}
          />
          <Button
            size="small"
            startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
            onClick={() => handleCopy(info.slug)}
          >
            Копировать
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Адрес виджета:
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 12.5, wordBreak: 'break-all' }}>
            {info.widgetUrl}
          </Typography>
        </Box>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 1.5 }}>
          Домены для встраивания
        </Typography>
        {info.origins.length === 0 ? (
          <Alert severity="warning">
            Домены не указаны, поэтому браузер заблокирует показ виджета на вашем сайте.
            Добавьте адрес сайта (например, <b>https://example.com</b>) в разделе
            «Настройки системы» → «Домены для встраивания виджета», по одному URL на строку.
          </Alert>
        ) : (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {info.origins.map((o) => (
                <Chip key={o} label={o} size="small" variant="outlined" />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Изменить список можно в разделе «Настройки системы».
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
