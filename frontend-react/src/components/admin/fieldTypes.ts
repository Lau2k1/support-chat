import type { TicketFieldType } from '@/types';

export const FIELD_TYPE_LABELS: Record<TicketFieldType, string> = {
  text: 'Текстовое поле',
  textarea: 'Текстовая область',
  number: 'Числовое поле',
  select: 'Выбор (список)',
  multiselect: 'Множественный выбор',
  radio: 'Радио-кнопки',
  checkbox: 'Чекбокс',
  date: 'Дата',
  file: 'Файл',
  title: 'Заголовок',
  divider: 'Разделитель',
};

export const OPTION_TYPES: TicketFieldType[] = ['select', 'multiselect', 'radio', 'checkbox'];

export function isLayoutType(type: TicketFieldType): boolean {
  return type === 'title' || type === 'divider';
}

export function createFieldId(): string {
  return Math.random().toString(36).slice(2, 9);
}
