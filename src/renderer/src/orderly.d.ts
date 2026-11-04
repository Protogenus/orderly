import type { OrderlyApi } from '../../preload/index.js';

declare global {
  interface Window {
    orderly: OrderlyApi;
  }
}

export {};
