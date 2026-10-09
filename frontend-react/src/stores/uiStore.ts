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
  showConfirm: (options: ConfirmOptions) => void;
  hideConfirm: () => void;
  showToast: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  hideToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  confirmDialog: null,
  toast: null,

  showConfirm: (options) => set({ confirmDialog: options }),
  hideConfirm: () => set({ confirmDialog: null }),

  showToast: (message, severity = 'success') => {
    set({ toast: { message, severity } });
    setTimeout(() => set({ toast: null }), 3000);
  },
  hideToast: () => set({ toast: null }),
}));
