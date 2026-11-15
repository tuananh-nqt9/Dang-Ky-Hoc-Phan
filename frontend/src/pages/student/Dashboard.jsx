import DashboardLayout from '../../components/common/DashboardLayout.jsx';
import StudentInfoCard from '../../components/student/StudentInfoCard.jsx';
import TuitionSummaryCard from '../../components/student/TuitionSummaryCard.tsx';
import RegisteredCoursesCarousel from '../../components/student/RegisteredCoursesCarousel.jsx';
import { getCurrentUser, isAuthenticated } from '../../services/authService.js';

export default function StudentDashboard() {
  const user = getCurrentUser();
  const displayName = user?.full_name || user?.student_id || 'Sinh viên';

  return (
    <DashboardLayout role="STUDENT" stickyHeader>
      <div className="space-y-6">
        <section aria-label="Lời chào" className="py-1">
          <div className="student-greeting-text">
            <p className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
              Xin chào, <span className="text-red-700">{displayName}</span>!
            </p>
            <p className="mt-1 text-sm text-gray-600 sm:text-base">Chào mừng bạn quay trở lại.</p>
          </div>
        </section>
        <StudentInfoCard user={user} sessionActive={isAuthenticated()} />
        <RegisteredCoursesCarousel />
        <TuitionSummaryCard />
      </div>
      <a
        href="https://www.facebook.com/hoangzngan/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Nhắn tin hỗ trợ qua Messenger"
        title="Nhắn tin hỗ trợ qua Messenger"
        className="fixed bottom-6 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#0866FF] shadow-lg transition hover:scale-105 hover:bg-[#0757d5] focus:outline-none focus:ring-4 focus:ring-blue-200"
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
          <path
            fill="white"
            d="M12 2.5c-5.8 0-10 4.25-10 9.55 0 2.87 1.25 5.42 3.28 7.15.17.14.27.35.27.57l.03 2.05a.8.8 0 0 0 1.12.74l2.29-1.01c.19-.08.4-.1.6-.04.76.21 1.57.32 2.41.32 5.8 0 10-4.25 10-9.55S17.8 2.5 12 2.5Z"
          />
          <path
            fill="#0866FF"
            d="m5.9 14.6 3.35-5.32a1.1 1.1 0 0 1 1.6-.29l2.67 2 3.13-2.37c.42-.32.98.18.7.63L14 14.57a1.1 1.1 0 0 1-1.6.29l-2.67-2-3.13 2.37c-.42.32-.98-.18-.7-.63Z"
          />
        </svg>
      </a>
    </DashboardLayout>
  );
}
