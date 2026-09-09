import type { InstalledBaseApi } from '@/shared';

declare global {
  interface Window {
    installedBaseApi: InstalledBaseApi;
  }
}

export {};
