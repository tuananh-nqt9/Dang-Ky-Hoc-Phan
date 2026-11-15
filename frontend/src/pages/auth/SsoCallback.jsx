import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, LoaderCircle } from 'lucide-react';
import { exchangeSsoCode, saveAuthData } from '../../services/authService.js';
import ptitLogo from '../../assets/ptitlogo.png';
import SiteFooter from '../../components/common/SiteFooter.jsx';

export default function SsoCallback() {
  const navigate = useNavigate();
  const exchangedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (exchangedRef.current) {
      return;
    }
    exchangedRef.current = true;

    const searchParams = new URLSearchParams(window.location.search);
    const exchangeCode = searchParams.get('exchange_code')?.trim() || '';
    const ssoError = searchParams.get('error')?.trim() || '';

    // Scrub one-time exchange_code / error from the browser URL bar immediately
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (ssoError) {
      setError('Đăng nhập SSO không thành công hoặc đã bị từ chối. Vui lòng thử lại.');
      return;
    }

    if (!exchangeCode) {
      setError('Không tìm thấy mã xác thực SSO hợp lệ. Vui lòng đăng nhập lại.');
      return;
    }

    exchangeSsoCode(exchangeCode)
      .then((result) => {
        const authData = result?.data;
        const role = authData?.student?.role;

        if (!authData?.access_token || !authData?.refresh_token || !role) {
          setError('Phản hồi xác thực SSO từ máy chủ không đầy đủ.');
          return;
        }

        saveAuthData(authData);
        navigate(role === 'ADMIN' ? '/admin/dashboard' : '/student/dashboard', {
          replace: true,
        });
      })
      .catch((requestError) => {
        setError(
          requestError.response?.data?.message ||
            'Mã xác thực SSO không hợp lệ, đã hết hạn hoặc đã được sử dụng.',
        );
      });
  }, [navigate]);

  return (
    <main className="flex min-h-screen flex-col bg-gray-50">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <img
            src={ptitLogo}
            alt="Logo PTIT"
            className="mx-auto h-14 w-14 rounded-xl border border-red-100 bg-white object-contain"
          />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Xác thực SSO</h1>

          {error ? (
            <div className="mt-5 space-y-4">
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
              <Link
                to="/login"
                replace
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Quay lại trang đăng nhập
              </Link>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-3 text-sm text-gray-600" role="status">
              <LoaderCircle className="h-7 w-7 animate-spin text-red-600" aria-hidden="true" />
              <p>Đang hoàn tất đăng nhập SSO, vui lòng đợi trong giây lát...</p>
            </div>
          )}
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
