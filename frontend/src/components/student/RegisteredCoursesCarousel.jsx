import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  ArrowRight,
  RotateCw,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getCourseClass } from '../../services/courseService.js';
import { getMyRegistrations } from '../../services/registrationService.js';

const weekDays = {
  MON: 'Thứ 2',
  TUE: 'Thứ 3',
  WED: 'Thứ 4',
  THU: 'Thứ 5',
  FRI: 'Thứ 6',
  SAT: 'Thứ 7',
  SUN: 'Chủ nhật',
};

function getVisibleCardCount(width) {
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 3;
}

function getScheduleText(schedule) {
  if (!schedule?.length) return 'Chưa có lịch học';
  return schedule
    .map((item) => {
      const day = weekDays[item.day_of_week] || item.day_of_week;
      const room = item.room ? ` · Phòng ${item.room}` : '';
      return `${day}, tiết ${item.start_period}–${item.end_period}${room}`;
    })
    .join(' · ');
}

function getRegistrationError(error) {
  return error.response?.data?.message || error.message || 'Không thể tải học phần đã đăng ký.';
}

function getRegistrationStatus(status) {
  return status === 'ACTIVE' ? 'Đã đăng ký' : status;
}

function CourseCard({ registration, onSelect }) {
  const course = registration.course;

  return (
    <button
      type="button"
      onClick={() => onSelect(registration)}
      className="group flex h-full min-h-52 w-full flex-col rounded-xl border border-red-500 bg-linear-to-br from-red-100 via-red-500 to-red-500 p-5 text-left text-white shadow-sm shadow-red-900/20 transition duration-200 hover:-translate-y-0.5 hover:border-red-600 hover:from-red-600 hover:via-red-600 hover:to-red-700 hover:shadow-md hover:shadow-red-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      aria-label={`Xem chi tiết học phần ${registration.course_name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white">
            {course?.course_code || registration.class_code}
          </p>
          <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-white">
            {registration.course_name || course?.course_name || 'Học phần'}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-red-700">
          {getRegistrationStatus(registration.status)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-2.5 py-1.5 text-white">
          <BookOpen className="h-3.5 w-3.5 text-red-100" aria-hidden="true" />
          {registration.class_code || course?.class_code || '—'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-2.5 py-1.5 text-white">
          {registration.credits ?? course?.credits ?? '—'} tín chỉ
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-white/20 pt-4 text-xs text-white/90">
        <CalendarDays className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
        <span className="line-clamp-2">{getScheduleText(course?.schedule)}</span>
      </div>
    </button>
  );
}

function CourseDetailDialog({ registration, onClose }) {
  const course = registration.course;
  const prerequisites = course?.prerequisites || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-950/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="registered-course-title"
        className="my-auto w-full max-w-xl rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
              {course?.course_code || registration.class_code}
            </p>
            <h2 id="registered-course-title" className="mt-1 text-xl font-bold text-gray-900">
              {registration.course_name || course?.course_name || 'Chi tiết học phần'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <dl className="grid gap-px bg-gray-200 sm:grid-cols-2">
          <div className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-gray-500">Mã lớp học phần</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{course?.class_code || registration.class_code || '—'}</dd>
          </div>
          <div className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-gray-500">Số tín chỉ</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">{registration.credits ?? course?.credits ?? '—'}</dd>
          </div>
          <div className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-gray-500">Trạng thái đăng ký</dt>
            <dd className="mt-1 text-sm font-semibold text-emerald-700">{getRegistrationStatus(registration.status)}</dd>
          </div>
          <div className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-gray-500">Ngày đăng ký</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">
              {registration.registered_at ? new Date(registration.registered_at).toLocaleString('vi-VN') : '—'}
            </dd>
          </div>
        </dl>

        <div className="space-y-4 p-5">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Clock3 className="h-4 w-4 text-red-600" aria-hidden="true" />
              Lịch học
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">{getScheduleText(course?.schedule)}</p>
          </div>
          {prerequisites.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Học phần tiên quyết</h3>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {prerequisites.map((prerequisite) => (
                  <li key={prerequisite.course_code}>
                    {prerequisite.course_code} · {prerequisite.course_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {registration.detailError && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
              Chưa tải được lịch và thông tin lớp chi tiết.
            </p>
          )}
        </div>
        <div className="border-t border-gray-200 px-5 py-4 text-right">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Đóng
          </button>
        </div>
      </section>
    </div>
  );
}

export default function RegisteredCoursesCarousel() {
  const [registrations, setRegistrations] = useState([]);
  const [visibleCardCount, setVisibleCardCount] = useState(() => (
    typeof window === 'undefined' ? 3 : getVisibleCardCount(window.innerWidth)
  ));
  const [activeSlide, setActiveSlide] = useState(1);
  const [resetTransition, setResetTransition] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRegistrations = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const firstResponse = await getMyRegistrations({ page: 1, pageSize: 100, status: 'ACTIVE' });
      const firstData = firstResponse?.data;
      if (!Array.isArray(firstData?.items) || !firstData.pagination) {
        throw new Error('Dữ liệu danh sách học phần không hợp lệ.');
      }

      const allRegistrations = [...firstData.items];
      for (let page = 2; page <= firstData.pagination.total_pages; page += 1) {
        const response = await getMyRegistrations({ page, pageSize: 100, status: 'ACTIVE' });
        const data = response?.data;
        if (!Array.isArray(data?.items) || !data.pagination) {
          throw new Error('Dữ liệu danh sách học phần không hợp lệ.');
        }
        allRegistrations.push(...data.items);
      }

      const registrationsWithDetails = await Promise.all(
        allRegistrations.map(async (registration) => {
          try {
            const detailResponse = await getCourseClass(registration.course_class_id);
            const course = detailResponse?.data?.course_class;
            if (!course) throw new Error('Dữ liệu chi tiết lớp học phần không hợp lệ.');
            return { ...registration, course, detailError: '' };
          } catch (detailRequestError) {
            return {
              ...registration,
              course: null,
              detailError: getRegistrationError(detailRequestError),
            };
          }
        }),
      );

      setRegistrations(registrationsWithDetails);
      setActiveSlide(1);
    } catch (requestError) {
      setError(getRegistrationError(requestError));
      setRegistrations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  useEffect(() => {
    const handleResize = () => {
      setVisibleCardCount(getVisibleCardCount(window.innerWidth));
      setActiveSlide(1);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const pages = useMemo(() => {
    const result = [];
    for (let index = 0; index < registrations.length; index += visibleCardCount) {
      result.push(registrations.slice(index, index + visibleCardCount));
    }
    return result;
  }, [registrations, visibleCardCount]);
  const hasCarousel = registrations.length > visibleCardCount;
  const displayedPages = hasCarousel
    ? [pages[pages.length - 1], ...pages, pages[0]]
    : pages;

  useEffect(() => {
    if (!hasCarousel) return undefined;
    const timer = window.setInterval(() => {
      setActiveSlide((currentSlide) => currentSlide + 1);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasCarousel, pages.length]);

  useEffect(() => {
    if (!resetTransition) return undefined;
    const frame = window.requestAnimationFrame(() => setResetTransition(false));
    return () => window.cancelAnimationFrame(frame);
  }, [resetTransition]);

  const movePage = (direction) => {
    setActiveSlide((currentSlide) => currentSlide + direction);
  };

  const handleSlideTransitionEnd = (event) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform' || !hasCarousel) return;
    if (activeSlide === 0) {
      setResetTransition(true);
      setActiveSlide(pages.length);
    } else if (activeSlide === pages.length + 1) {
      setResetTransition(true);
      setActiveSlide(1);
    }
  };

  return (
    <>
      <section aria-labelledby="registered-courses-heading" className="student-dashboard-card rounded-2xl border border-gray-200 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="registered-courses-heading" className="text-lg font-semibold text-gray-900">Học phần đã đăng ký</h2>
            {!loading && !error && registrations.length > 0 && (
              <p className="mt-1 text-sm text-gray-500">{registrations.length} học phần đang đăng ký</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/student/registration"
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
              Đăng ký ngay
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              to="/student/my-courses"
              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              Học phần của tôi <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            {hasCarousel && (
              <>
                <button
                  type="button"
                  onClick={() => movePage(-1)}
                  aria-label="Học phần trước"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => movePage(1)}
                  aria-label="Học phần tiếp theo"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={loadRegistrations}
              disabled={loading}
              aria-label="Làm mới danh sách học phần"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Đang tải học phần đã đăng ký">
            {Array.from({ length: visibleCardCount }, (_, index) => (
              <div key={index} className="h-52 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
            ))}
            <span className="sr-only">Đang tải học phần đã đăng ký...</span>
          </div>
        ) : error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center" role="alert">
            <AlertCircle className="mx-auto h-8 w-8 text-red-600" aria-hidden="true" />
            <p className="mt-2 text-sm text-red-700">{error}</p>
            <button type="button" onClick={loadRegistrations} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:text-red-800">
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Thử tải lại
            </button>
          </div>
        ) : registrations.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
            <BookOpen className="mx-auto h-9 w-9 text-gray-300" aria-hidden="true" />
            <p className="mt-3 font-medium text-gray-900">Bạn chưa đăng ký học phần nào</p>
            <p className="mt-1 text-sm text-gray-500">Các học phần đã đăng ký sẽ xuất hiện tại đây.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 overflow-hidden" aria-live="polite">
              <div
                onTransitionEnd={handleSlideTransitionEnd}
                className={`flex transition-transform duration-500 ease-in-out motion-reduce:transition-none ${resetTransition ? 'duration-0!' : ''}`}
                style={{ transform: `translate3d(-${(hasCarousel ? activeSlide : 0) * 100}%, 0, 0)` }}
              >
                {displayedPages.map((page, pageIndex) => (
                  <div
                    key={`page-${pageIndex}`}
                    className="grid w-full shrink-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    aria-hidden={hasCarousel && (pageIndex === 0 || pageIndex === pages.length + 1) ? true : undefined}
                    inert={hasCarousel && (pageIndex === 0 || pageIndex === pages.length + 1)}
                  >
                    {page.map((registration) => (
                      <CourseCard
                        key={`${pageIndex}-${registration.registration_id}`}
                        registration={registration}
                        onSelect={setSelectedRegistration}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {hasCarousel && (
              <div className="mt-5 flex items-center justify-center gap-2" aria-label="Vị trí học phần">
                {pages.map((page, index) => (
                  <button
                    key={`dot-${page[0].registration_id}`}
                    type="button"
                    onClick={() => setActiveSlide(index + 1)}
                    aria-label={`Hiển thị nhóm học phần ${index + 1}`}
                    aria-current={(
                      activeSlide === index + 1 ||
                      (index === 0 && activeSlide === pages.length + 1) ||
                      (index === pages.length - 1 && activeSlide === 0)
                    ) ? 'true' : undefined}
                    className={`h-2.5 rounded-full transition-all ${
                      activeSlide === index + 1 ||
                      (index === 0 && activeSlide === pages.length + 1) ||
                      (index === pages.length - 1 && activeSlide === 0)
                        ? 'w-6 bg-red-600'
                        : 'w-2.5 bg-gray-300 hover:bg-red-300'
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {selectedRegistration && (
        <CourseDetailDialog
          registration={selectedRegistration}
          onClose={() => setSelectedRegistration(null)}
        />
      )}
    </>
  );
}
