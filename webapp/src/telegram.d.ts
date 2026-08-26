declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        showAlert: (message: string) => void;
        openInvoice: (url: string, callback?: (status: string) => void) => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string) => void;
        initData: string;
        version?: string;
        colorScheme?: 'light' | 'dark';
        CloudStorage?: {
          setItem: (key: string, value: string, callback?: (err: unknown, ok: boolean) => void) => void;
          getItem: (key: string, callback: (err: unknown, value: string | null) => void) => void;
          removeItem: (key: string, callback?: (err: unknown, ok: boolean) => void) => void;
        };
        HapticFeedback?: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
        };
      };
    };
  }
}

export {};
