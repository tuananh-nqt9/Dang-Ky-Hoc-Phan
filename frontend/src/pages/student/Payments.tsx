import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  LoaderCircle,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import qrPaymentImage from '../../assets/qrcodembbank.jpg';
import DashboardLayout from '../../components/common/DashboardLayout.jsx';
import { getCurrentUser } from '../../services/authService.js';
import {
  createStudentPayment,
  getAllCourseClasses,
  getAllStudentPayments,
  getAllStudentRegistrations,
  getApiErrorMessage,
} from '../../services/paymentService';
import {
  summarizeTuition,
  type PaymentRecord,
  type PaymentStatusFilter,
  type StudentRegistration,
} from '../../services/paymentTypes';
import type { CourseClass } from '../../services/adminTypes';
import { createIdempotencyKey } from '../../utils/idempotency.js';

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const rowsPerPage = 10;
const attemptStoragePrefix = 'student-payment-attempt:';

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function getStoredAttempt(registrationId: string, attempts: Map<string, string>) {
  const memoryAttempt = attempts.get(registrationId);
  if (memoryAttempt) return memoryAttempt;

  const storageKey = `${attemptStoragePrefix}${registrationId}`;
  try {
    const storedAttempt = window.sessionStorage.getItem(storageKey);
    if (storedAttempt && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storedAttempt)) {
      attempts.set(registrationId, storedAttempt);
      return storedAttempt;
    }
  } catch {
    return createAndStoreAttempt(registrationId, attempts);
  }

  return createAndStoreAttempt(registrationId, attempts);
}

function createAndStoreAttempt(registrationId: string, attempts: Map<string, string>) {
  const key = createIdempotencyKey();
  attempts.set(registrationId, key);
  try {
    window.sessionStorage.setItem(`${attemptStoragePrefix}${registrationId}`, key);
  } catch {
    return key;
  }
  return key;
}

function clearStoredAttempt(registrationId: string, attempts: Map<string, string>) {
  attempts.delete(registrationId);
  try {
    window.sessionStorage.removeItem(`${attemptStoragePrefix}${registrationId}`);
  } catch {
    return;
  }
}

interface PaymentRequestFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds: number;
}

interface BatchFailure extends PaymentRequestFailure {
  completed: number;
  total: number;
  failedClassCode: string;
}

interface BatchProgress {
  completed: number;
  total: number;
  currentClassCode: string;
}

function getPaymentRequestFailure(error: unknown): PaymentRequestFailure {
  const requestError = error && typeof error === 'object'
    ? error as {
      code?: string;
      response?: {
        status?: number;
        data?: unknown;
        headers?: { get?: (key: string) => unknown; [key: string]: unknown };
      };
    }
    : {};
  const responseData = requestError.response?.data;
  const apiError = responseData && typeof responseData === 'object'
    ? responseData as { code?: unknown; message?: unknown }
    : {};
  const code = typeof apiError.code === 'string' ? apiError.code : '';
  const status = requestError.response?.status;
  const retryable = !status ||
    requestError.code === 'ECONNABORTED' ||
    code === 'REQUEST_IN_PROGRESS' ||
    code === 'SERVICE_BUSY' ||
    code === 'SERVICE_UNAVAILABLE' ||
    status === 503 ||
    status === 429;
  const headers = requestError.response?.headers;
  const rawRetryAfter = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : headers?.['retry-after'] ?? headers?.['Retry-After'];
  const retryAfterValue = typeof rawRetryAfter === 'string' || typeof rawRetryAfter === 'number'
    ? String(rawRetryAfter)
    : '';
  const retryAfterSeconds = Number(retryAfterValue);
  const parsedDate = Date.parse(retryAfterValue);
  const delaySeconds = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, Math.ceil(retryAfterSeconds))
    : Number.isNaN(parsedDate)
      ? 0
      : Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));

  const defaultMessage = code === 'ALREADY_PAID'
    ? 'Khoản thu này đã được thanh toán. Dữ liệu sẽ được đồng bộ lại.'
    : code === 'REQUEST_IN_PROGRESS'
      ? 'Yêu cầu thanh toán đang được xử lý. Hãy thử lại sau thời gian chờ.'
      : code === 'IDEMPOTENCY_KEY_REUSED'
        ? 'Không thể xác nhận yêu cầu do mã chống trùng không khớp. Hãy tải lại dữ liệu.'
        : 'Không thể ghi nhận khoản thanh toán. Vui lòng kiểm tra và thử lại.';
  const message = typeof apiError.message === 'string' && apiError.message
    ? apiError.message
    : defaultMessage;

  return { code, message, retryable, retryAfterSeconds: delaySeconds };
}

function InfoCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-15.5 grid-cols-[116px_minmax(0,1fr)] border-b border-r border-gray-200 last:border-b-0 sm:grid-cols-[128px_minmax(0,1fr)]">
      <dt className="flex items-center bg-gray-50 px-3 py-3 text-xs font-medium text-gray-600 sm:px-4 sm:text-sm">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center wrap-break-word px-3 py-3 text-sm text-gray-800 sm:px-4">
        {children}
      </dd>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: StudentRegistration['payment_status'] }) {
  const className = status === 'PAID'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'REFUNDED'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-red-200 bg-red-50 text-red-700';
  const label = status === 'PAID' ? 'Đã thanh toán' : status === 'REFUNDED' ? 'Đã hoàn tiền' : 'Chưa thanh toán';

  return (
    <span className={`inline-flex whitespace-nowrap rounded border px-2 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export default function StudentPayments() {
  const navigate = useNavigate();
  const student = getCurrentUser();
  const [registrations, setRegistrations] = useState<StudentRegistration[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [courseClasses, setCourseClasses] = useState<CourseClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'DETAILS' | 'HISTORY'>('DETAILS');
  const [compactDetails, setCompactDetails] = useState(false);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [paying, setPaying] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [batchFailure, setBatchFailure] = useState<BatchFailure | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>('ALL');
  const [historyPage, setHistoryPage] = useState(1);
  const pendingAttempts = useRef(new Map<string, string>());

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');

    try {
      const [nextRegistrations, nextClasses, nextPayments] = await Promise.all([
        getAllStudentRegistrations('ALL'),
        getAllCourseClasses(),
        getAllStudentPayments('ALL'),
      ]);
      setRegistrations(nextRegistrations);
      setCourseClasses(nextClasses);
      setPayments(nextPayments);
      setHasLoaded(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Không thể tải dữ liệu học phí và thanh toán.'));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadData());
  }, [loadData]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setRetryAfterSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfterSeconds]);

  const activeRegistrations = useMemo(
    () => registrations.filter((registration) => registration.status === 'ACTIVE'),
    [registrations],
  );
  const unpaidRegistrations = useMemo(
    () => activeRegistrations.filter((registration) => registration.payment_status === 'UNPAID'),
    [activeRegistrations],
  );
  const summary = useMemo(() => summarizeTuition(activeRegistrations), [activeRegistrations]);
  const totalUnpaidAmount = unpaidRegistrations.reduce((total, registration) => total + registration.tuition_amount, 0);
  const courseClassById = useMemo(
    () => new Map(courseClasses.map((courseClass) => [courseClass.course_class_id, courseClass])),
    [courseClasses],
  );
  const registrationById = useMemo(
    () => new Map(registrations.map((registration) => [registration.registration_id, registration])),
    [registrations],
  );
  const filteredPayments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('vi');
    return payments
      .filter((payment) => statusFilter === 'ALL' || payment.status === statusFilter)
      .filter((payment) => {
        if (!normalizedSearch) return true;
        const registration = registrationById.get(payment.registration_id);
        const courseClass = courseClassById.get(payment.course_class_id);
        return [
          payment.payment_id,
          payment.course_class_id,
          payment.class_code,
          registration?.course_name,
          courseClass?.course_code,
          payment.status,
        ].some((value) => value?.toLocaleLowerCase('vi').includes(normalizedSearch));
      });
  }, [courseClassById, payments, registrationById, search, statusFilter]);
  const totalHistoryPages = Math.max(1, Math.ceil(filteredPayments.length / rowsPerPage));
  const currentHistoryPage = Math.min(historyPage, totalHistoryPages);
  const visiblePayments = filteredPayments.slice(
    (currentHistoryPage - 1) * rowsPerPage,
    currentHistoryPage * rowsPerPage,
  );
  const collectionStatus = summary.amountDue > 0
    ? 'Chưa thanh toán'
    : summary.amountPaid > 0
      ? 'Đã thanh toán'
      : 'Chưa phát sinh';

  async function submitAllUnpaid() {
    const targets = unpaidRegistrations;
    if (!targets.length || paying) return;

    setPaying(true);
    setBatchFailure(null);
    setRetryAfterSeconds(0);
    setProgress({ completed: 0, total: targets.length, currentClassCode: targets[0].class_code });
    let completed = 0;
    const initialTotal = targets.reduce((total, registration) => total + registration.tuition_amount, 0);

    try {
      for (const registration of targets) {
        setProgress({
          completed,
          total: targets.length,
          currentClassCode: registration.class_code,
        });
        const idempotencyKey = getStoredAttempt(registration.registration_id, pendingAttempts.current);

        try {
          await createStudentPayment(registration.registration_id, idempotencyKey);
          clearStoredAttempt(registration.registration_id, pendingAttempts.current);
          completed += 1;
        } catch (requestError) {
          const failure = getPaymentRequestFailure(requestError);
          if (failure.code === 'ALREADY_PAID' || !failure.retryable) {
            clearStoredAttempt(registration.registration_id, pendingAttempts.current);
          }
          setBatchFailure({
            ...failure,
            completed,
            total: targets.length,
            failedClassCode: registration.class_code,
          });
          setRetryAfterSeconds(failure.retryAfterSeconds);
          if (completed > 0) {
            setNotice(`Đã ghi nhận ${completed}/${targets.length} khoản. Hãy kiểm tra trạng thái các khoản còn lại.`);
          }
          await loadData(false);
          return;
        }
      }

      setShowPaymentConfirmation(false);
      setNotice(`Đã ghi nhận thanh toán mô phỏng cho ${completed} khoản, tổng ${formatCurrency(initialTotal)}.`);
      await loadData(false);
    } finally {
      setPaying(false);
      setProgress(null);
    }
  }

  function closePaymentConfirmation() {
    if (paying) return;
    setShowPaymentConfirmation(false);
    setBatchFailure(null);
    setRetryAfterSeconds(0);
  }

  function paymentStatusLabel(payment: PaymentRecord) {
    return payment.status === 'PAID' ? 'Đã thanh toán' : 'Đã hoàn tiền';
  }

  return (
    <DashboardLayout role="STUDENT" stickyHeader>
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => navigate('/student/dashboard')}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-red-700"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-red-600 text-white shadow-sm transition hover:bg-red-700">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </span>
            Quay lại
          </button>
        </div>
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4 sm:px-6">
            <div>
              <p className="text-sm font-semibold text-red-700">Sinh viên</p>
              <h1 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">Thông tin thanh toán</h1>
            </div>
          </div>

          {notice && (
            <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:mx-6" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{notice}</span>
              <button type="button" className="ml-auto" onClick={() => setNotice('')} aria-label="Đóng thông báo">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {error && (
            <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6" role="alert">
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </span>
              <button type="button" onClick={() => loadData()} className="font-semibold hover:text-red-900">
                Thử tải lại
              </button>
            </div>
          )}

          {loading && !hasLoaded ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-gray-500" role="status">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Đang tải thông tin thanh toán...
            </div>
          ) : (
            <>
              <dl className="mx-4 mt-4 grid overflow-hidden rounded-md border border-gray-200 sm:mx-5 sm:grid-cols-2 lg:mx-6">
                <InfoCell label="Đợt thu">Học phí các học phần đang đăng ký</InfoCell>
                <InfoCell label="Người nộp tiền">
                  <span className="min-w-0">
                    {student?.full_name || 'Sinh viên'}
                    {student?.student_id ? ` - ${student.student_id}` : ''}
                  </span>
                </InfoCell>
                <InfoCell label="Trạng thái">
                  <span className={`rounded border px-2 py-1 text-xs font-medium ${
                    summary.amountDue > 0
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : summary.amountPaid > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}>
                    {collectionStatus}
                  </span>
                </InfoCell>
                <InfoCell label="Số học phần">
                  {numberFormatter.format(summary.registrationCount)}
                </InfoCell>
                <InfoCell label="Tổng thành tiền">
                  <strong className="font-semibold text-gray-900">{formatCurrency(summary.totalTuition)}</strong>
                </InfoCell>
                <InfoCell label="Tổng số tín chỉ">
                  {numberFormatter.format(summary.totalCredits)}
                </InfoCell>
                <InfoCell label="Số tiền đã nộp">
                  <span className="font-medium text-emerald-700">{formatCurrency(summary.amountPaid)}</span>
                </InfoCell>
                <InfoCell label="Số tiền còn lại phải nộp">
                  <span className="font-semibold text-red-700">{formatCurrency(summary.amountDue)}</span>
                </InfoCell>
              </dl>

              <div className="mt-5 border-b border-gray-200 px-4 sm:px-5 lg:px-6">
                <div className="flex gap-7">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'DETAILS'}
                    onClick={() => setTab('DETAILS')}
                    className={`border-b-2 px-0.5 pb-2.5 text-sm font-medium ${
                      tab === 'DETAILS' ? 'border-red-600 text-red-700' : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Chi tiết
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'HISTORY'}
                    onClick={() => setTab('HISTORY')}
                    className={`border-b-2 px-0.5 pb-2.5 text-sm font-medium ${
                      tab === 'HISTORY' ? 'border-red-600 text-red-700' : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Lịch sử giao dịch
                  </button>
                </div>
              </div>

              {tab === 'DETAILS' ? (
                <section role="tabpanel" aria-label="Chi tiết khoản thu" className="px-4 pb-5 pt-4 sm:px-5 lg:px-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        setBatchFailure(null);
                        setRetryAfterSeconds(0);
                        setShowPaymentConfirmation(true);
                      }}
                      disabled={unpaidRegistrations.length === 0 || paying}
                      className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      Thanh toán ngay
                    </button>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={compactDetails}
                        onChange={(event) => setCompactDetails(event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 accent-red-600"
                      />
                      Rút gọn
                    </label>
                    <span className="text-xs italic text-gray-500">
                      {unpaidRegistrations.length
                        ? `${unpaidRegistrations.length} khoản chưa nộp · ${formatCurrency(totalUnpaidAmount)}`
                        : 'Không còn khoản học phí chưa nộp.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => loadData()}
                      disabled={loading}
                      aria-label="Làm mới thông tin thanh toán"
                      title="Làm mới"
                      className="ml-auto rounded-md border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    </button>
                  </div>

                  {compactDetails ? (
                    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-600">
                      Chi tiết học phần đang được thu gọn.
                    </div>
                  ) : activeRegistrations.length === 0 ? (
                    <div className="mt-4 rounded-md border border-gray-200 px-4 py-12 text-center">
                      <FileText className="mx-auto h-9 w-9 text-gray-300" aria-hidden="true" />
                      <p className="mt-3 font-semibold text-gray-900">Chưa có học phần đang đăng ký</p>
                      <p className="mt-1 text-sm text-gray-500">Các khoản học phí sẽ hiển thị tại đây sau khi đăng ký.</p>
                    </div>
                  ) : (
                    <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                      <table className="w-full min-w-197.5 border-collapse text-left text-sm">
                        <thead className="bg-gray-50 text-gray-700">
                          <tr>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 text-center font-semibold">TT</th>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 font-semibold">Nội dung</th>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 font-semibold">Đơn giá/tín chỉ</th>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 text-center font-semibold">Tín chỉ</th>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 font-semibold">Thành tiền</th>
                            <th className="border-b border-r border-gray-200 px-3 py-2.5 font-semibold">Thời gian tạo</th>
                            <th className="border-b border-gray-200 px-3 py-2.5 font-semibold">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeRegistrations.map((registration, index) => {
                            const courseClass = courseClassById.get(registration.course_class_id);
                            const unitPrice = registration.credits > 0
                              ? registration.tuition_amount / registration.credits
                              : null;
                            return (
                              <tr key={registration.registration_id} className="hover:bg-gray-50">
                                <td className="border-b border-r border-gray-200 px-3 py-2.5 text-center text-gray-600">{index + 1}</td>
                                <td className="max-w-80 border-b border-r border-gray-200 px-3 py-2.5">
                                  <p className="font-medium text-gray-900">{registration.course_name}</p>
                                  <p className="mt-0.5 text-xs text-gray-500">
                                    {courseClass?.course_code ? `${courseClass.course_code} · ` : ''}
                                    {registration.class_code}
                                  </p>
                                </td>
                                <td className="border-b border-r border-gray-200 px-3 py-2.5 text-gray-700">
                                  {unitPrice === null ? '—' : `${formatCurrency(unitPrice)}/TC`}
                                </td>
                                <td className="border-b border-r border-gray-200 px-3 py-2.5 text-center text-gray-700">
                                  {numberFormatter.format(registration.credits)}
                                </td>
                                <td className="border-b border-r border-gray-200 px-3 py-2.5 font-medium text-gray-900">
                                  {formatCurrency(registration.tuition_amount)}
                                </td>
                                <td className="border-b border-r border-gray-200 px-3 py-2.5 whitespace-nowrap text-gray-600">
                                  {formatDate(registration.registered_at)}
                                </td>
                                <td className="border-b border-gray-200 px-3 py-2.5">
                                  <PaymentStatusBadge status={registration.payment_status} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-gray-50 font-semibold text-gray-900">
                          <tr>
                            <td colSpan={4} className="border-r border-gray-200 px-3 py-2.5 text-right">Tổng học phí</td>
                            <td className="border-r border-gray-200 px-3 py-2.5">{formatCurrency(summary.totalTuition)}</td>
                            <td colSpan={2} className="px-3 py-2.5" />
                          </tr>
                          <tr>
                            <td colSpan={4} className="border-r border-gray-200 px-3 py-2.5 text-right">Đã nộp / Còn phải nộp</td>
                            <td className="border-r border-gray-200 px-3 py-2.5">
                              <span className="text-emerald-700">{formatCurrency(summary.amountPaid)}</span>
                              <span className="px-1 text-gray-400">/</span>
                              <span className="text-red-700">{formatCurrency(summary.amountDue)}</span>
                            </td>
                            <td colSpan={2} className="px-3 py-2.5" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </section>
              ) : (
                <section role="tabpanel" aria-label="Lịch sử giao dịch" className="px-4 pb-5 pt-4 sm:px-5 lg:px-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-gray-900">Lịch sử giao dịch</h2>
                    </div>
                    <span className="text-sm text-gray-500">{filteredPayments.length} giao dịch</span>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <label className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setHistoryPage(1);
                        }}
                        placeholder="Tìm mã giao dịch hoặc mã lớp..."
                        aria-label="Tìm kiếm lịch sử thanh toán"
                        className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                    </label>
                    <select
                      value={statusFilter}
                      onChange={(event) => {
                        setStatusFilter(event.target.value as PaymentStatusFilter);
                        setHistoryPage(1);
                      }}
                      aria-label="Lọc trạng thái giao dịch"
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    >
                      <option value="ALL">Tất cả trạng thái</option>
                      <option value="PAID">Đã thanh toán</option>
                      <option value="REFUNDED">Đã hoàn tiền</option>
                    </select>
                  </div>

                  {visiblePayments.length === 0 ? (
                    <div className="mt-4 rounded-md border border-gray-200 px-4 py-12 text-center">
                      <FileText className="mx-auto h-9 w-9 text-gray-300" aria-hidden="true" />
                      <p className="mt-3 font-semibold text-gray-900">
                        {payments.length ? 'Không tìm thấy giao dịch phù hợp' : 'Chưa có lịch sử giao dịch'}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {payments.length ? 'Thử từ khóa hoặc trạng thái khác.' : 'Giao dịch sẽ xuất hiện tại đây sau khi API ghi nhận.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
                        <table className="w-full min-w-195 text-left text-sm">
                          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                            <tr>
                              <th className="px-3 py-3 font-semibold">Mã giao dịch</th>
                              <th className="px-3 py-3 font-semibold">Mã lớp</th>
                              <th className="px-3 py-3 font-semibold">Số tiền</th>
                              <th className="px-3 py-3 font-semibold">Trạng thái</th>
                              <th className="px-3 py-3 font-semibold">Thời gian</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {visiblePayments.map((payment) => (
                              <tr key={payment.payment_id} className="hover:bg-gray-50">
                                <td className="px-3 py-3 font-medium text-gray-900">{payment.payment_id}</td>
                                <td className="px-3 py-3 text-gray-600">{payment.class_code}</td>
                                <td className="px-3 py-3 font-semibold text-gray-900">{formatCurrency(payment.amount)}</td>
                                <td className="px-3 py-3">
                                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    payment.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                  }`}>
                                    {paymentStatusLabel(payment)}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-gray-600">{formatDate(payment.paid_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-600">
                        <span>Trang {currentHistoryPage}/{totalHistoryPages}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                            disabled={currentHistoryPage <= 1}
                            aria-label="Trang trước"
                            className="rounded-md border border-gray-300 p-1.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setHistoryPage((page) => Math.min(totalHistoryPages, page + 1))}
                            disabled={currentHistoryPage >= totalHistoryPages}
                            aria-label="Trang sau"
                            className="rounded-md border border-gray-300 p-1.5 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
          <div className="flex justify-center border-t border-gray-200 px-5 py-3">
            <button
              type="button"
              onClick={() => navigate('/student/dashboard')}
              className="rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Đóng
            </button>
          </div>
        </section>
      </div>

      {showPaymentConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !paying) closePaymentConfirmation();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-confirmation-title"
            className="my-auto w-full max-w-xl rounded-lg bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-red-700">Xác nhận thanh toán</p>
                <h2 id="payment-confirmation-title" className="mt-1 text-lg font-bold text-gray-900">Thanh toán một lần</h2>
              </div>
              <button type="button" onClick={closePaymentConfirmation} disabled={paying} aria-label="Đóng" className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
                <div>
                  <p className="text-gray-500">Số khoản chưa thanh toán</p>
                  <p className="mt-1 font-semibold text-gray-900">{unpaidRegistrations.length} học phần</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-500">Tổng cần nộp</p>
                  <p className="mt-1 font-bold text-red-700">{formatCurrency(totalUnpaidAmount)}</p>
                </div>
              </div>

              {progress && (
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Đang xử lý {progress.currentClassCode} · hoàn tất {progress.completed}/{progress.total}
                </div>
              )}

              {batchFailure && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  <p className="font-semibold">Chưa hoàn tất toàn bộ khoản thu</p>
                  <p className="mt-1">{batchFailure.message}</p>
                  <p className="mt-1 text-xs">
                    Đã nhận phản hồi thành công {batchFailure.completed}/{batchFailure.total}; lỗi tại lớp {batchFailure.failedClassCode}.
                    Các khoản đã hoàn tất không bị gửi lại.
                  </p>
                  {retryAfterSeconds > 0 && (
                    <p className="mt-1 text-xs">Vui lòng đợi {retryAfterSeconds} giây theo thời gian chờ của API.</p>
                  )}
                  {batchFailure.retryable && (
                    <p className="mt-1 text-xs">Thử lại sẽ dùng lại cùng mã idempotency cho khoản đang lỗi.</p>
                  )}
                </div>
              )}

              <div className="flex flex-col items-center rounded-md border border-gray-200 p-3">
                <img
                  src={qrPaymentImage}
                  alt="Ảnh QR minh họa tĩnh, không dùng để chuyển khoản"
                  className="h-auto w-44 max-w-full rounded object-contain"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closePaymentConfirmation}
                  disabled={paying}
                  className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (batchFailure && !batchFailure.retryable) {
                      closePaymentConfirmation();
                      loadData();
                    } else {
                      submitAllUnpaid();
                    }
                  }}
                  disabled={paying || retryAfterSeconds > 0 || unpaidRegistrations.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {paying
                    ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : batchFailure && !batchFailure.retryable
                      ? <RotateCw className="h-4 w-4" aria-hidden="true" />
                      : <CreditCard className="h-4 w-4" aria-hidden="true" />}
                  {paying
                    ? 'Đang ghi nhận...'
                    : batchFailure && !batchFailure.retryable
                      ? 'Đóng và làm mới'
                      : batchFailure
                        ? 'Thử lại phần còn lại'
                        : `Xác nhận thanh toán`}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

    </DashboardLayout>
  );
}
