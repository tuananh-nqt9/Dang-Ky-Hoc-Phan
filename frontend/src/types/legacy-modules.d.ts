declare module '*DashboardLayout.jsx' {
  import type { ComponentType } from 'react';

  const component: ComponentType<Record<string, unknown>>;
  export default component;
}

declare module '*apiClient.js' {
  import type { AxiosInstance } from 'axios';

  const apiClient: AxiosInstance;
  export default apiClient;
}

declare module '*idempotency.js' {
  export function createIdempotencyKey(): string;
}

declare module '*authService.js' {
  export function getCurrentUser(): {
    full_name?: string;
    student_id?: string;
  } | null;
}
