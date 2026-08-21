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
