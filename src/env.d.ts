/// <reference types="vite/client" />

declare const __DEMO_BUILD__: boolean;
declare const __APP_VERSION__: string;

interface Window {
  CRM_CONFIG?: {
    supabaseUrl?: string;
    supabaseKey?: string;
    appName?: string;
  };
}
