import { create } from 'zustand';

type ConfirmOptions = {
  text: string;
  onConfirm: () => void;
  confirmLabel?: string;
  danger?: boolean;
};

interface UIState {
  confirmDialog: ConfirmOptions | null;
  toast: { message: string; severity: 'success' | 'error' | 'info' | 'warning' } | null;
  changePasswordOpen: boolean;
  telegramOpen: boolean;
  showConfirm: (options: ConfirmOptions) => void;
  hideConfirm: () => void;
  showToast: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  hideToast: () => void;
  showChangePassword: () => void;
  hideChangePassword: () => void;
  showTelegram: () => void;
  hideTelegram: () => void;
  /** Закрыть диалоги и подсказки при смене пользователя. */
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  confirmDialog: null,
  toast: null,
  changePasswordOpen: false,
  telegramOpen: false,

  showConfirm: (options) => set({ confirmDialog: options }),
  hideConfirm: () => set({ confirmDialog: null }),

  showToast: (message, severity = 'success') => {
    set({ toast: { message, severity } });
    setTimeout(() => set({ toast: null }), 3000);
  },
  hideToast: () => set({ toast: null }),

  showChangePassword: () => set({ changePasswordOpen: true }),
  hideChangePassword: () => set({ changePasswordOpen: false }),

  showTelegram: () => set({ telegramOpen: true }),
  hideTelegram: () => set({ telegramOpen: false }),

  reset: () => set({ confirmDialog: null, toast: null, changePasswordOpen: false, telegramOpen: false }),
}));
