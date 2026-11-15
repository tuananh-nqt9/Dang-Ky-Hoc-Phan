import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, LoaderCircle, RotateCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAllStudentRegistrations, getApiErrorMessage } from '../../services/paymentService';
import { summarizeTuition, type TuitionSummary } from '../../services/paymentTypes';

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export default function TuitionSummaryCard() {
  const [summary, setSummary] = useState<TuitionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hoveredSegment, setHoveredSegment] = useState<'paid' | 'due' | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      setSummary(summarizeTuition(await getAllStudentRegistrations('ACTIVE')));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Không thể tải thông tin học phí.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadSummary);
  }, [loadSummary]);

  const paymentTotal = summary ? summary.amountPaid + summary.amountDue : 0;
  const paidPercent = summary && paymentTotal > 0
    ? Math.round((summary.amountPaid / paymentTotal) * 100)
    : 0;
  const duePercent = paymentTotal > 0 ? 100 - paidPercent : 0;
  const ringRadius = 42;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const paidRingOffset = ringCircumference * (1 - paidPercent / 100);

  return (
    <section className="student-dashboard-card rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-red-700">Công nợ</p>
          <h2 className="mt-0.5 text-lg font-bold text-gray-900">Tổng quan học phí</h2>
        </div>
        <Link
          to="/student/payments"
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          Chi tiết thanh toán <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Đang tải học phí...
        </div>
      ) : error ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={loadSummary}
            className="inline-flex items-center gap-1 font-semibold hover:text-red-900"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" /> Thử lại
          </button>
        </div>
      ) : summary ? (
        <div className="mt-4 grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: 'Học phần đã đăng ký', value: numberFormatter.format(summary.registrationCount) },
              { label: 'Tổng số tín chỉ', value: numberFormatter.format(summary.totalCredits) },
              {
                label: 'Đơn giá tín chỉ',
                value: summary.averageCreditPrice === null ? '—' : formatCurrency(summary.averageCreditPrice),
              },
              { label: 'Tổng học phí', value: formatCurrency(summary.totalTuition) },
              { label: 'Học phí đã thanh toán', value: formatCurrency(summary.amountPaid), valueClass: 'text-emerald-700' },
              { label: 'Còn phải thanh toán', value: formatCurrency(summary.amountDue), valueClass: 'text-red-700' },
            ].map((item) => (
              <div key={item.label} className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 sm:px-3">
                <p className="text-[11px] font-medium leading-4 text-gray-500 sm:text-xs">{item.label}</p>
                <p className={`mt-1 wrap-break-word text-sm font-bold sm:text-base ${item.valueClass || 'text-gray-900'}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <div
            role="img"
            aria-label={`Đã thanh toán ${paidPercent} phần trăm, còn phải thanh toán ${duePercent} phần trăm`}
            className="flex items-center justify-center gap-4 rounded-lg border border-gray-100 bg-white/70 p-3 lg:flex-col"
          >
            <div className="relative h-28 w-28 shrink-0">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle
                  cx="50"
                  cy="50"
                  r={ringRadius}
                  fill="none"
                  stroke={summary.amountDue > 0 ? '#EAB308' : '#E5E7EB'}
                  color="#EAB308"
                  strokeWidth="10"
                  pointerEvents="stroke"
                  onPointerEnter={() => setHoveredSegment('due')}
                  onPointerLeave={() => setHoveredSegment(null)}
                  className={`tuition-progress-segment ${hoveredSegment === 'due' ? 'is-highlighted' : ''}`}
                />
                <circle
                  cx="50"
                  cy="50"
                  r={ringRadius}
                  fill="none"
                  stroke="#059669"
                  color="#059669"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={paidRingOffset}
                  pointerEvents="stroke"
                  onPointerEnter={() => setHoveredSegment('paid')}
                  onPointerLeave={() => setHoveredSegment(null)}
                  className={`tuition-progress-segment tuition-progress-segment-paid ${hoveredSegment === 'paid' ? 'is-highlighted' : ''}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-gray-900">{paidPercent}%</span>
                <span className="text-[10px] font-medium text-gray-500">Đã nộp</span>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden="true" />
                <span className="text-gray-600">Đã nộp: {paidPercent}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" aria-hidden="true" />
                <span className="text-gray-600">Còn nợ: {duePercent}%</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
