import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
} from '@mui/material';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { Operator } from '@/types';

export default function OperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getOperators();
      setOperators(res.data);
    } catch {
      showToast('Ошибка загрузки операторов', 'error');
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = (id: number, isAdmin: boolean) => {
    if (isAdmin) { showToast('Нельзя отключить админа', 'error'); return; }
    showConfirm({
      text: 'Изменить статус оператора?',
      onConfirm: async () => {
        try {
          await adminApi.toggleOperator(id);
          load();
        } catch { showToast('Ошибка', 'error'); }
      },
    });
  };

  const handleChangeRole = (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'operator' : 'admin';
    const label = newRole === 'admin' ? 'админа' : 'оператора';
    showConfirm({
      text: `Изменить роль на "${label}"?`,
      onConfirm: async () => {
        try {
          await adminApi.changeRole(id, newRole);
          load();
        } catch { showToast('Ошибка', 'error'); }
      },
    });
  };

  const handleDelete = (id: number, isAdmin: boolean) => {
    if (isAdmin) { showToast('Нельзя удалить админа', 'error'); return; }
    showConfirm({
      text: 'Удалить оператора? Это действие необратимо.',
      danger: true,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminApi.deleteOperator(id);
          load();
          showToast('Оператор удалён');
        } catch { showToast('Ошибка удаления', 'error'); }
      },
    });
  };

  return (
    <Paper sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Список операторов</Typography>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <HeadCell>ID</HeadCell>
              <HeadCell>Имя</HeadCell>
              <HeadCell>Email</HeadCell>
              <HeadCell>Роль</HeadCell>
              <HeadCell>Статус</HeadCell>
              <HeadCell>Включён</HeadCell>
              <HeadCell>Действия</HeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {operators.map((op) => (
              <TableRow key={op.id} hover>
                <TableCell>{op.id}</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>{op.name}</TableCell>
                <TableCell>{op.email}</TableCell>
                <TableCell>
                  <Chip
                    label={op.role === 'admin' ? 'Админ' : 'Оператор'}
                    size="small"
                    sx={{
                      bgcolor: op.role === 'admin' ? '#dbeafe' : '#f1f5f9',
                      color: op.role === 'admin' ? '#1d4ed8' : '#64748b',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={op.status || 'offline'}
                    size="small"
                    sx={{
                      bgcolor: op.status === 'online' ? '#dcfce7' : op.status === 'busy' ? '#fef9c3' : '#f1f5f9',
                      color: op.status === 'online' ? '#16a34a' : op.status === 'busy' ? '#a16207' : '#64748b',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={op.is_enabled ? 'Да' : 'Нет'}
                    size="small"
                    sx={{
                      bgcolor: op.is_enabled ? '#dcfce7' : '#fee2e2',
                      color: op.is_enabled ? '#16a34a' : '#dc2626',
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={op.role === 'admin'}
                      onClick={() => handleToggle(op.id, op.role === 'admin')}
                    >
                      {op.is_enabled ? 'Отключить' : 'Включить'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleChangeRole(op.id, op.role)}
                    >
                      {op.role === 'admin' ? '→ Оператор' : '→ Админ'}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      disabled={op.role === 'admin'}
                      onClick={() => handleDelete(op.id, op.role === 'admin')}
                    >
                      Удалить
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <TableCell
      sx={{
        fontSize: 11,
        fontWeight: 600,
        color: 'text.secondary',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        bgcolor: '#f8fafc',
      }}
    >
      {children}
    </TableCell>
  );
}
