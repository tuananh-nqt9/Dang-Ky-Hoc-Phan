import apiClient from './apiClient.js';
import type {
  ApiEnvelope,
  CourseClassListData,
  Pagination,
} from './adminTypes';
import type { PaymentRecord, PaymentStatusFilter, StudentRegistration } from './paymentTypes';

interface MyRegistrationsData {
  items: StudentRegistration[];
  pagination: Pagination;
}

interface MyPaymentsData {
  items: PaymentRecord[];
  pagination: Pagination;
}

interface PaginatedItems<T> {
  items: T[];
  pagination: Pagination;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const requestError = error as {
      message?: unknown;
      response?: { data?: unknown };
    };
    const data = requestError.response?.data;
    if (data && typeof data === 'object' && 'message' in data &&
        typeof data.message === 'string' && data.message) {
      return data.message;
    }
    if (typeof requestError.message === 'string' && requestError.message) {
      return requestError.message;
    }
  }
  return fallback;
}

function assertPaginatedData<T>(
  data: PaginatedItems<T> | undefined,
  message: string,
): asserts data is PaginatedItems<T> {
  if (!data || !Array.isArray(data.items) || !data.pagination ||
      !Number.isInteger(data.pagination.total_pages) || data.pagination.total_pages < 0) {
    throw new Error(message);
  }
}

export async function getAllStudentRegistrations(
  status: 'ACTIVE' | 'CANCELLED' | 'ALL' = 'ACTIVE',
): Promise<StudentRegistration[]> {
  const firstResponse = await apiClient.get<ApiEnvelope<MyRegistrationsData>>('/v1/registrations/me', {
    params: { page: 1, page_size: 100, status },
  });
  const firstData = firstResponse.data.data;
  assertPaginatedData(firstData, 'Dữ liệu danh sách đăng ký không hợp lệ.');
  const items = [...firstData.items];

  for (let page = 2; page <= firstData.pagination.total_pages; page += 1) {
    const response = await apiClient.get<ApiEnvelope<MyRegistrationsData>>('/v1/registrations/me', {
      params: { page, page_size: 100, status },
    });
    const data = response.data.data;
    assertPaginatedData(data, 'Dữ liệu danh sách đăng ký không hợp lệ.');
    items.push(...data.items);
  }

  return items;
}

export async function getAllStudentPayments(
  status: PaymentStatusFilter = 'ALL',
): Promise<PaymentRecord[]> {
  const firstResponse = await apiClient.get<ApiEnvelope<MyPaymentsData>>('/v1/payments/me', {
    params: { page: 1, page_size: 100, status },
  });
  const firstData = firstResponse.data.data;
  assertPaginatedData(firstData, 'Dữ liệu lịch sử thanh toán không hợp lệ.');
  const items = [...firstData.items];

  for (let page = 2; page <= firstData.pagination.total_pages; page += 1) {
    const response = await apiClient.get<ApiEnvelope<MyPaymentsData>>('/v1/payments/me', {
      params: { page, page_size: 100, status },
    });
    const data = response.data.data;
    assertPaginatedData(data, 'Dữ liệu lịch sử thanh toán không hợp lệ.');
    items.push(...data.items);
  }

  return items;
}

export async function getAllCourseClasses() {
  const firstResponse = await apiClient.get<ApiEnvelope<CourseClassListData>>('/v1/course-classes', {
    params: { page: 1, page_size: 100 },
  });
  const firstData = firstResponse.data.data;
  assertPaginatedData(firstData, 'Dữ liệu danh sách lớp học phần không hợp lệ.');
  const items = [...firstData.items];

  for (let page = 2; page <= firstData.pagination.total_pages; page += 1) {
    const response = await apiClient.get<ApiEnvelope<CourseClassListData>>('/v1/course-classes', {
      params: { page, page_size: 100 },
    });
    const data = response.data.data;
    assertPaginatedData(data, 'Dữ liệu danh sách lớp học phần không hợp lệ.');
    items.push(...data.items);
  }

  return items;
}

export async function createStudentPayment(registrationId: string, idempotencyKey: string): Promise<PaymentRecord> {
  const response = await apiClient.post<ApiEnvelope<{ payment: PaymentRecord }>>(
    '/v1/payments',
    { registration_id: registrationId },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return response.data.data.payment;
}
