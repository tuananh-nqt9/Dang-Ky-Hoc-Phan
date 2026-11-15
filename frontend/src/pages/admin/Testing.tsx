import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileUp,
  FlaskConical,
  Loader2,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  XCircle,
} from 'lucide-react';
import DashboardLayout from '../../components/common/DashboardLayout.jsx';
import { getAllAdminCourseClasses } from '../../services/adminService';
import type { CourseClass } from '../../services/adminTypes';

type TestTab = 'configuration' | 'results';
const TestingLineChart = lazy(() => import('./TestingLineChart'));

interface DbSeatState {
  capacity: number;
  remaining_seats: number;
  active_registrations: number;
}

interface ScenarioReportItem {
  id: string;
  title: string;
  description: string;
  passed: boolean;
  conclusion: string;
  before: DbSeatState;
  after: DbSeatState;
  codes: Record<string, number>;
  metrics: {
    vus: number;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate_percent: number;
    avg_response_time_ms: number;
    p95_ms: number;
    p99_ms: number;
    rps: number;
  };
}

interface DetailedTestReport {
  report_type: 'acceptance_kt' | 'loadtest';
  generated_at: string;
  scenarios: ScenarioReportItem[];
  aggregated_codes: Record<string, number>;
}

const chartMetricDefinitions = [
  { label: 'Tổng request', aliases: ['total_requests'], color: '#334155' },
  { label: 'Request thành công', aliases: ['successful_requests', 'success'], color: '#16a34a' },
  { label: 'Request thất bại', aliases: ['failed_requests', 'failure'], color: '#dc2626' },
  { label: 'Tỷ lệ thành công (%)', aliases: ['success_rate_percent', 'success_rate_pct'], color: '#7c3aed' },
  { label: 'Average response time (ms)', aliases: ['avg_response_time_ms', 'average_response_time_ms'], color: '#2563eb' },
  { label: 'P95 (ms)', aliases: ['p95_ms'], color: '#ea580c' },
  { label: 'P99 (ms)', aliases: ['p99_ms'], color: '#be123c' },
  { label: 'RPS', aliases: ['rps', 'requests_per_second'], color: '#0891b2' },
] as const;

const httpCodeMeta: Record<string, { label: string; badgeClass: string; barColor: string }> = {
  '200:REGISTERED': {
    label: '200 REGISTERED (Đăng ký thành công)',
    badgeClass: 'border-green-200 bg-green-50 text-green-800',
    barColor: 'bg-green-600',
  },
  '200:REGISTRATION_CANCELLED': {
    label: '200 REGISTRATION_CANCELLED (Hủy & hoàn +1 chỗ)',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-800',
    barColor: 'bg-sky-600',
  },
  '409:CLASS_FULL': {
    label: '409 CLASS_FULL (Chặn vượt sĩ số khi hết chỗ)',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
    barColor: 'bg-amber-500',
  },
  '409:ALREADY_REGISTERED': {
    label: '409 ALREADY_REGISTERED (Chặn đăng ký trùng)',
    badgeClass: 'border-purple-200 bg-purple-50 text-purple-800',
    barColor: 'bg-purple-600',
  },
  '409:SCHEDULE_CONFLICT': {
    label: '409 SCHEDULE_CONFLICT (Chặn trùng lịch học)',
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-800',
    barColor: 'bg-rose-600',
  },
  '409:PREREQUISITE_NOT_MET': {
    label: '409 PREREQUISITE_NOT_MET (Chặn thiếu tiên quyết)',
    badgeClass: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    barColor: 'bg-indigo-600',
  },
};

function getCodeMeta(codeKey: string) {
  return (
    httpCodeMeta[codeKey] ?? {
      label: codeKey,
      badgeClass: 'border-gray-200 bg-gray-100 text-gray-800',
      barColor: 'bg-gray-600',
    }
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, '_');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function downloadText(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = error.response;
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = response.data;
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
        return data.message;
      }
    }
  }
  return error instanceof Error ? error.message : 'Không thể tải dữ liệu.';
}

export default function Testing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTab = searchParams.get('tab');
  const tab: TestTab = selectedTab === 'results' ? 'results' : 'configuration';
  const [courses, setCourses] = useState<CourseClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Load-test runner state
  const [vuLevels, setVuLevels] = useState('10,50,100');
  const [classCapacity, setClassCapacity] = useState('3000');
  const [durationSeconds, setDurationSeconds] = useState('60');
  const [targetClassId, setTargetClassId] = useState('');

  // Acceptance test (KT1..KT5) state
  const [competingStudents, setCompetingStudents] = useState('50');
  const [repeatedRequests, setRepeatedRequests] = useState('50');
  const [conflictStudents, setConflictStudents] = useState('20');
  const [regrabStudents, setRegrabStudents] = useState('30');

  // Execution status & results state
  const [runningMode, setRunningMode] = useState<'none' | 'loadtest' | 'kt'>('none');
  const [executionLogs, setExecutionLogs] = useState('');
  const [lastRunTitle, setLastRunTitle] = useState('');
  const [csv, setCsv] = useState('');
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvError, setCsvError] = useState('');
  const [selectedChartMetric, setSelectedChartMetric] = useState('');

  // Detailed structured reports for Before/After comparison, HTTP code breakdown, and Full Report Export
  const [activeReport, setActiveReport] = useState<DetailedTestReport | null>(null);
  const [savedKtReport, setSavedKtReport] = useState<DetailedTestReport | null>(null);
  const [savedLoadtestReport, setSavedLoadtestReport] = useState<DetailedTestReport | null>(null);

  useEffect(() => {
    let active = true;
    getAllAdminCourseClasses()
      .then((loadedCourses) => {
        if (!active) return;
        setCourses(loadedCourses);
        if (loadedCourses.length) setTargetClassId(loadedCourses[0].course_class_id);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Tự động nạp báo cáo gần nhất trên đĩa (nếu có) để hiển thị ngay khi mở trang
    fetch('/__local_testing/latest-reports')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            ok?: boolean;
            kt_csv?: string;
            loadtest_csv?: string;
            kt_report?: DetailedTestReport | null;
            loadtest_report?: DetailedTestReport | null;
          } | null,
        ) => {
          if (!active || !data?.ok) return;
          if (data.kt_report) setSavedKtReport(data.kt_report);
          if (data.loadtest_report) setSavedLoadtestReport(data.loadtest_report);
          if (data.kt_csv) {
            const parsed = parseCsv(data.kt_csv);
            if (parsed.length > 1) {
              setCsv(data.kt_csv);
              setCsvRows(parsed);
              setLastRunTitle('Kết quả gần nhất: Bộ 5 kịch bản nghiệm thu (KT1 · KT2 · KT3 · KT4 · KT5)');
              if (data.kt_report) setActiveReport(data.kt_report);
            }
          } else if (data.loadtest_csv) {
            const parsed = parseCsv(data.loadtest_csv);
            if (parsed.length > 1) {
              setCsv(data.loadtest_csv);
              setCsvRows(parsed);
              setLastRunTitle('Kết quả gần nhất: Đo tải đa mức');
              if (data.loadtest_report) setActiveReport(data.loadtest_report);
            }
          }
        },
      )
      .catch(() => {
        // Ignore if not available
      });

    return () => {
      active = false;
    };
  }, []);

  const tabs = useMemo(
    () => [
      { id: 'configuration' as const, label: 'Chạy kiểm thử trực tiếp', Icon: SlidersHorizontal },
      { id: 'results' as const, label: 'Kết quả & Nhập CSV', Icon: FlaskConical },
    ],
    [],
  );

  const importedSummary = useMemo(() => {
    if (csvRows.length < 2) return null;
    const headers = csvRows[0].map(normalizeHeader);
    const dataRows = csvRows.slice(1);
    const findIdx = (...names: string[]) => headers.findIndex((header) => names.includes(header));
    const readAll = (...names: string[]) => {
      const index = findIdx(...names);
      if (index < 0) return [];
      return dataRows.map((row) => Number(row[index])).filter((val) => Number.isFinite(val));
    };
    const sumVals = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) : undefined);
    const avgVals = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined);
    const maxVals = (vals: number[]) => (vals.length ? Math.max(...vals) : undefined);

    const total = sumVals(readAll('total_requests'));
    const success = sumVals(readAll('successful_requests', 'success'));
    const failure = sumVals(readAll('failed_requests', 'failure'));
    const totalRequests = total ?? (success !== undefined && failure !== undefined ? success + failure : undefined);
    const successRate =
      totalRequests && success !== undefined
        ? (success / totalRequests) * 100
        : avgVals(readAll('success_rate_percent', 'success_rate_pct'));
    return {
      totalRequests,
      success,
      failure,
      successRate,
      average: avgVals(readAll('avg_response_time_ms', 'average_response_time_ms')),
      p95: maxVals(readAll('p95_ms')),
      p99: maxVals(readAll('p99_ms')),
      rps: avgVals(readAll('rps', 'requests_per_second')),
    };
  }, [csvRows]);

  const chartMetrics = useMemo(() => {
    if (csvRows.length < 2) return [];
    const headers = csvRows[0].map(normalizeHeader);
    return chartMetricDefinitions.flatMap((definition) => {
      const index = headers.findIndex((header) => definition.aliases.some((alias) => alias === header));
      if (index < 0 || !csvRows.slice(1).some((row) => row[index]?.trim() !== '' && Number.isFinite(Number(row[index])))) {
        return [];
      }
      return [{ key: headers[index], index, label: definition.label, color: definition.color }];
    });
  }, [csvRows]);

  const selectedMetric = chartMetrics.find((metric) => metric.key === selectedChartMetric) ?? chartMetrics[0];

  const chartData = useMemo(() => {
    if (csvRows.length < 2 || !selectedMetric) return [];
    const headers = csvRows[0].map(normalizeHeader);
    const labelIndex = headers.findIndex((header) =>
      ['run_at', 'timestamp', 'time', 'date', 'run_id', 'run', 'iteration'].includes(header),
    );
    return csvRows
      .slice(1)
      .map((row, index) => {
        const rawValue = row[selectedMetric.index]?.trim();
        const value = rawValue ? Number(rawValue) : Number.NaN;
        const label = labelIndex >= 0 && row[labelIndex]?.trim() ? row[labelIndex].trim() : `Lượt ${index + 1}`;
        return { label, value };
      })
      .filter((point) => Number.isFinite(point.value));
  }, [csvRows, selectedMetric]);

  const chooseTab = (nextTab: TestTab) => {
    setSearchParams({ tab: nextTab }, { replace: true });
  };

  const applyCsvText = (text: string, title?: string, report?: DetailedTestReport | null) => {
    const rows = parseCsv(text);
    if (rows.length < 1 || rows[0].length < 1) {
      throw new Error('Dữ liệu CSV không hợp lệ.');
    }
    setCsv(text);
    setCsvRows(rows);
    if (title) setLastRunTitle(title);
    if (report !== undefined) setActiveReport(report);
  };

  const importCsv = async (file?: File) => {
    setCsvError('');
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith('.csv')) {
      setCsvError('Vui lòng chọn tệp CSV.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCsvError('Tệp CSV không được vượt quá 5 MB.');
      return;
    }
    try {
      const text = await file.text();
      const lowerName = file.name.toLocaleLowerCase();
      const matchedReport = lowerName.includes('kt')
        ? savedKtReport
        : lowerName.includes('load') || lowerName.includes('sample')
          ? savedLoadtestReport
          : null;
      applyCsvText(text, `Dữ liệu nhập từ tệp ${file.name}`, matchedReport);
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Không đọc được tệp CSV.');
      setCsv('');
      setCsvRows([]);
    }
  };

  const exportCsv = () => {
    if (!csv) return;
    downloadText('ket-qua-kiem-thu.csv', csv, 'text/csv;charset=utf-8');
  };

  const exportMarkdownReport = () => {
    const nowStr = new Date().toLocaleString('vi-VN');
    const lines: string[] = [
      '# BÁO CÁO KẾT QUẢ KIỂM THỬ NGHIỆM THU & ĐO TẢI HỆ THỐNG ĐĂNG KÝ HỌC PHẦN',
      '',
      `- **Thời gian xuất báo cáo:** ${nowStr}`,
      `- **Bất biến toàn vẹn dữ liệu (Database Invariant):** \`remaining_seats >= 0\`, \`active_registrations <= capacity\`, và \`remaining_seats + active_registrations == capacity\`.`,
      '',
    ];

    const ktRep = activeReport?.report_type === 'acceptance_kt' ? activeReport : savedKtReport;
    const ltRep = activeReport?.report_type === 'loadtest' ? activeReport : savedLoadtestReport;

    if (ktRep && ktRep.scenarios.length > 0) {
      lines.push('## 1. Bảng Đối Soát Các Kịch Bản Nghiệm Thu (KT1 – KT5)');
      lines.push('');
      lines.push('| Mã | Kịch bản kiểm thử | Trước khi chạy (Before) | Sau khi chạy (After) | Phân bổ phản hồi HTTP | Độ trễ Avg / P95 (ms) | Kết luận |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const sc of ktRep.scenarios) {
        const beforeStr = `Cap: ${sc.before.capacity}, Trống: ${sc.before.remaining_seats}, ĐK: ${sc.before.active_registrations}`;
        const afterStr = `Cap: ${sc.after.capacity}, Trống: ${sc.after.remaining_seats}, ĐK: ${sc.after.active_registrations}`;
        const codesStr = Object.entries(sc.codes)
          .map(([k, v]) => `\`${k}\`: ${v}`)
          .join(', ');
        const latStr = `${sc.metrics.avg_response_time_ms} / ${sc.metrics.p95_ms} ms`;
        const statusStr = sc.passed ? '**PASS**' : '**FAIL**';
        lines.push(`| **${sc.id}** | ${sc.title}<br>*(${sc.description})* | ${beforeStr} | ${afterStr} | ${codesStr} | ${latStr} | ${statusStr} — ${sc.conclusion} |`);
      }
      lines.push('');
    }

    if (ltRep && ltRep.scenarios.length > 0) {
      lines.push('## 2. Bảng Kết Quả Đo Tải Đa Mức (Load Testing)');
      lines.push('');
      lines.push('| Mức tải (VUs) | Tổng request | Thành công (200) | Bị chặn (409) | Tỷ lệ (%) | Avg (ms) | P95 (ms) | P99 (ms) | RPS | Đối soát Invariant |');
      lines.push('|---|---|---|---|---|---|---|---|---|---|');
      for (const sc of ltRep.scenarios) {
        const m = sc.metrics;
        const invText = sc.passed
          ? `**PASS** (${sc.after.remaining_seats} + ${sc.after.active_registrations} = ${sc.after.capacity})`
          : '**FAIL**';
        lines.push(
          `| **${m.vus} VUs** | ${m.total_requests} | ${m.successful_requests} | ${m.failed_requests} | ${m.success_rate_percent}% | ${m.avg_response_time_ms} | ${m.p95_ms} | ${m.p99_ms} | ${m.rps} | ${invText} |`,
        );
      }
      lines.push('');
    }

    if (activeReport && Object.keys(activeReport.aggregated_codes).length > 0) {
      lines.push('## 3. Thống Kê Phân Bổ Mã Phản Hồi HTTP');
      lines.push('');
      lines.push('| Mã phản hồi (HTTP + Domain Code) | Số lượng request |');
      lines.push('|---|---|');
      for (const [codeKey, count] of Object.entries(activeReport.aggregated_codes)) {
        lines.push(`| \`${codeKey}\` | **${count}** |`);
      }
      lines.push('');
    }

    downloadText('bao-cao-kiem-thu-dkhp.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  const exportHtmlReport = () => {
    const nowStr = new Date().toLocaleString('vi-VN');
    const ktRep = activeReport?.report_type === 'acceptance_kt' ? activeReport : savedKtReport;
    const ltRep = activeReport?.report_type === 'loadtest' ? activeReport : savedLoadtestReport;

    const renderScenarioRows = (rep: DetailedTestReport) =>
      rep.scenarios
        .map((sc) => {
          const codesHtml = Object.entries(sc.codes)
            .map(([k, v]) => `<div><code>${k}</code>: <strong>${v}</strong></div>`)
            .join('');
          const badge = sc.passed
            ? `<span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:4px;font-weight:700;">PASS</span>`
            : `<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:4px;font-weight:700;">FAIL</span>`;
          return `
            <tr>
              <td><strong>${sc.id}</strong></td>
              <td><strong>${sc.title}</strong><br/><small style="color:#475569">${sc.description}</small></td>
              <td>Sức chứa: <b>${sc.before.capacity}</b><br/>Chỗ trống: <b>${sc.before.remaining_seats}</b><br/>ĐK Active: <b>${sc.before.active_registrations}</b></td>
              <td>Sức chứa: <b>${sc.after.capacity}</b><br/>Chỗ trống: <b>${sc.after.remaining_seats}</b><br/>ĐK Active: <b>${sc.after.active_registrations}</b></td>
              <td>${codesHtml}</td>
              <td>Avg: ${sc.metrics.avg_response_time_ms} ms<br/>P95: ${sc.metrics.p95_ms} ms<br/>RPS: ${sc.metrics.rps}</td>
              <td>${badge}<br/><small>${sc.conclusion}</small></td>
            </tr>`;
        })
        .join('');

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Báo Cáo Kiểm Thử Hệ Thống Đăng Ký Học Phần</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; }
    h1 { color: #991b1b; border-bottom: 2px solid #dc2626; padding-bottom: 8px; }
    h2 { color: #1e293b; margin-top: 28px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-weight: 700; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: Consolas, monospace; }
  </style>
</head>
<body>
  <h1>BÁO CÁO NGHIỆM THU & ĐO TẢI HỆ THỐNG ĐĂNG KÝ HỌC PHẦN TRỰC TUYẾN</h1>
  <p><strong>Thời gian xuất báo cáo:</strong> ${nowStr}</p>
  <p><strong>Quy tắc toàn vẹn (Database Invariant):</strong> <code>remaining_seats &gt;= 0</code>, <code>active_registrations &lt;= capacity</code>, và <code>remaining_seats + active_registrations == capacity</code>.</p>

  ${
    ktRep
      ? `<h2>1. Bảng Đối Soát Các Kịch Bản Nghiệm Thu (KT1 – KT5)</h2>
  <table>
    <thead>
      <tr>
        <th>Mã</th>
        <th>Kịch bản kiểm thử</th>
        <th>Trước khi chạy (Before)</th>
        <th>Sau khi chạy (After)</th>
        <th>Mã phản hồi HTTP</th>
        <th>Hiệu năng</th>
        <th>Kết luận Invariant</th>
      </tr>
    </thead>
    <tbody>${renderScenarioRows(ktRep)}</tbody>
  </table>`
      : ''
  }

  ${
    ltRep
      ? `<h2>2. Bảng Kết Quả Đo Tải Đa Mức (Load Testing)</h2>
  <table>
    <thead>
      <tr>
        <th>Mức tải</th>
        <th>Mô tả</th>
        <th>Trước khi chạy (Before)</th>
        <th>Sau khi chạy (After)</th>
        <th>Mã phản hồi HTTP</th>
        <th>Độ trễ & Thông lượng</th>
        <th>Kết luận Invariant</th>
      </tr>
    </thead>
    <tbody>${renderScenarioRows(ltRep)}</tbody>
  </table>`
      : ''
  }
</body>
</html>`;

    downloadText('bao-cao-kiem-thu-dkhp.html', html, 'text/html;charset=utf-8');
  };

  const exportConfiguration = () => {
    const target = courses.find((course) => course.course_class_id === targetClassId);
    const firstVu = Number.parseInt(vuLevels.split(',')[0]?.trim() || '10', 10) || 10;
    const config = {
      scenario: 'registration',
      vus: firstVu,
      vu_levels: vuLevels,
      capacity: Number(classCapacity) || 3000,
      duration_seconds: Number(durationSeconds) || 60,
      target_course_class_id: targetClassId,
      target_class_code: target?.class_code || '',
    };
    downloadText('cau-hinh-kiem-thu.json', JSON.stringify(config, null, 2), 'application/json;charset=utf-8');
  };

  const handleRunLoadTest = async () => {
    setCsvError('');
    setRunningMode('loadtest');
    try {
      const response = await fetch('/__local_testing/run-loadtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levels: vuLevels,
          capacity: Number(classCapacity) || 3000,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        csv?: string;
        logs?: string;
        report?: DetailedTestReport | null;
      };
      if (!response.ok || !payload.ok || !payload.csv) {
        if (payload.logs) setExecutionLogs(payload.logs);
        throw new Error(payload.message || 'Không thể thực thi bài đo tải.');
      }
      setExecutionLogs(payload.logs || '');
      if (payload.report) setSavedLoadtestReport(payload.report);
      applyCsvText(
        payload.csv,
        `Kết quả đo tải trực tiếp (VUs: ${vuLevels} · Sức chứa: ${classCapacity} chỗ)`,
        payload.report ?? null,
      );
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Lỗi khi chạy đo tải trực tiếp.');
    } finally {
      setRunningMode('none');
    }
  };

  const handleRunAcceptanceTests = async () => {
    setCsvError('');
    setRunningMode('kt');
    try {
      const response = await fetch('/__local_testing/run-kt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competing_students: Number(competingStudents) || 50,
          repeated_requests: Number(repeatedRequests) || 50,
          conflict_students: Number(conflictStudents) || 20,
          regrab_students: Number(regrabStudents) || 30,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        csv?: string;
        logs?: string;
        report?: DetailedTestReport | null;
      };
      if (!response.ok || !payload.ok || !payload.csv) {
        if (payload.logs) setExecutionLogs(payload.logs);
        throw new Error(payload.message || 'Không thể thực thi bộ kịch bản KT1–KT5.');
      }
      setExecutionLogs(payload.logs || '');
      if (payload.report) setSavedKtReport(payload.report);
      applyCsvText(
        payload.csv,
        'Kết quả thực thi 5 kịch bản nghiệm thu: KT1 · KT2 · KT3 · KT4 · KT5',
        payload.report ?? null,
      );
    } catch (error) {
      setCsvError(error instanceof Error ? error.message : 'Lỗi khi chạy bộ kịch bản KT1–KT5.');
    } finally {
      setRunningMode('none');
    }
  };

  const renderResultsDashboard = () => {
    if (!csvRows.length) return null;

    const totalCodeRequests = activeReport
      ? Object.values(activeReport.aggregated_codes).reduce((acc, v) => acc + v, 0)
      : 0;

    return (
      <div className="space-y-5">
        {/* Thanh tiêu đề kết quả & Cụm 3 nút Xuất Báo Cáo (Markdown / HTML-Word / CSV) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span>{lastRunTitle || 'Kết quả kiểm thử hệ thống'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportMarkdownReport}
              className="inline-flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-xs hover:bg-gray-50"
            >
              <FileText className="h-3.5 w-3.5 text-blue-600" /> Xuất Báo Cáo Markdown (.md)
            </button>
            <button
              type="button"
              onClick={exportHtmlReport}
              className="inline-flex items-center gap-1.5 border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-xs hover:bg-gray-50"
            >
              <FileCode2 className="h-3.5 w-3.5 text-purple-600" /> Xuất Báo Cáo Word / HTML (.html)
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-red-700"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
            </button>
          </div>
        </div>

        {/* Tính năng 1 (Nhóm 3): BẢNG TRẠNG THÁI PASS/FAIL TRỰC QUAN & ĐỐI SOÁT BEFORE -> AFTER */}
        {activeReport && activeReport.scenarios.length > 0 && (
          <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Bảng đối soát trạng thái Database (Before → After) &amp; Nghiệm thu PASS / FAIL
                </h3>
                <p className="mt-0.5 text-xs text-gray-500">
                  Kiểm chứng trực tiếp biến đổi của <code>remaining_seats</code> và <code>active_registrations</code> trước và sau mỗi kịch bản.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {activeReport.scenarios.filter((s) => s.passed).length}/{activeReport.scenarios.length} Kịch bản PASS
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-xs">
                <thead className="bg-gray-50 font-semibold text-gray-700">
                  <tr>
                    <th className="px-4 py-3">Kịch bản</th>
                    <th className="px-4 py-3">Trước khi chạy (Before)</th>
                    <th className="px-4 py-3">Sau khi chạy (After)</th>
                    <th className="px-4 py-3">Biến đổi chỗ trống &amp; ĐK</th>
                    <th className="px-4 py-3">Mã phản hồi HTTP</th>
                    <th className="px-4 py-3">Kết luận Invariant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeReport.scenarios.map((sc) => (
                    <tr key={sc.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3.5 align-top">
                        <div className="font-bold text-gray-900">{sc.title}</div>
                        <div className="mt-0.5 text-gray-500">{sc.description}</div>
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono text-gray-700">
                        <div>capacity: <strong>{sc.before.capacity}</strong></div>
                        <div>remaining: <strong>{sc.before.remaining_seats}</strong></div>
                        <div>active_reg: <strong>{sc.before.active_registrations}</strong></div>
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono text-gray-700">
                        <div>capacity: <strong>{sc.after.capacity}</strong></div>
                        <div>remaining: <strong>{sc.after.remaining_seats}</strong></div>
                        <div>active_reg: <strong>{sc.after.active_registrations}</strong></div>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <div className="inline-flex items-center gap-1.5 rounded-xs bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">
                          <span>Trống: {sc.before.remaining_seats}</span>
                          <ArrowRight className="h-3 w-3 text-slate-500" />
                          <span className="font-bold text-red-700">{sc.after.remaining_seats}</span>
                        </div>
                        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-xs bg-blue-50 px-2 py-1 font-mono text-xs text-blue-800">
                          <span>Active: {sc.before.active_registrations}</span>
                          <ArrowRight className="h-3 w-3 text-blue-500" />
                          <span className="font-bold text-blue-900">{sc.after.active_registrations}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(sc.codes).map(([codeKey, cnt]) => {
                            const meta = getCodeMeta(codeKey);
                            return (
                              <span
                                key={codeKey}
                                className={`inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[11px] font-semibold ${meta.badgeClass}`}
                              >
                                {codeKey}: {cnt}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top">
                        {sc.passed ? (
                          <span className="inline-flex items-center gap-1 rounded-xs bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-700" /> PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-xs bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">
                            <XCircle className="h-3.5 w-3.5 text-red-700" /> FAIL
                          </span>
                        )}
                        <p className="mt-1.5 text-xs text-gray-600">{sc.conclusion}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Tính năng 2 (Nhóm 3): BIỂU ĐỒ PHÂN BỔ MÃ PHẢN HỒI HTTP (HTTP CODE BREAKDOWN) */}
        {activeReport && totalCodeRequests > 0 && (
          <section className="border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-red-600" />
                <h3 className="font-semibold text-gray-900">
                  Biểu đồ phân bổ mã phản hồi HTTP &amp; Mã nghiệp vụ (Domain Error Breakdown)
                </h3>
              </div>
              <span className="text-xs font-medium text-gray-500">
                Tổng cộng: <strong>{totalCodeRequests.toLocaleString('vi-VN')}</strong> phản hồi
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {Object.entries(activeReport.aggregated_codes).map(([codeKey, count]) => {
                const meta = getCodeMeta(codeKey);
                const pct = totalCodeRequests > 0 ? (count / totalCodeRequests) * 100 : 0;
                return (
                  <div key={codeKey}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-gray-800">{meta.label}</span>
                      <span className="font-mono font-semibold text-gray-700">
                        {count.toLocaleString('vi-VN')} request ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden bg-gray-100">
                      <div className={`h-full transition-all duration-500 ${meta.barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Biểu đồ xu hướng theo kịch bản / mức tải */}
        <section className="border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">Biểu đồ xu hướng độ trễ &amp; thông lượng</h3>
              <p className="mt-1 text-sm text-gray-500">Chọn chỉ số để xem xu hướng theo các mức tải hoặc kịch bản.</p>
            </div>
            {chartMetrics.length > 0 && (
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                Chỉ số
                <select
                  value={selectedMetric?.key ?? ''}
                  onChange={(event) => setSelectedChartMetric(event.target.value)}
                  className="border border-gray-200 bg-white px-3 py-2 outline-none focus:border-red-400"
                >
                  {chartMetrics.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {selectedMetric && chartData.length > 0 ? (
            <div className="mt-5 h-80 w-full">
              <Suspense fallback={<div className="h-full animate-pulse bg-gray-50" role="status">Đang tải biểu đồ...</div>}>
                <TestingLineChart data={chartData} metricLabel={selectedMetric.label} color={selectedMetric.color} />
              </Suspense>
            </div>
          ) : (
            <p className="mt-5 border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              CSV chưa có cột số liệu kiểm thử phù hợp để vẽ biểu đồ.
            </p>
          )}
        </section>

        {importedSummary && Object.values(importedSummary).some((value) => value !== undefined) && (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Tổng request', importedSummary.totalRequests],
                ['Thành công', importedSummary.success],
                ['Bị chặn / Từ chối', importedSummary.failure],
                [
                  'Tỷ lệ thành công',
                  importedSummary.successRate === undefined ? undefined : `${importedSummary.successRate.toFixed(2)}%`,
                ],
                ['Average (ms)', importedSummary.average],
                ['P95 (ms)', importedSummary.p95],
                ['P99 (ms)', importedSummary.p99],
                ['RPS', importedSummary.rps],
              ]
                .filter(([, value]) => value !== undefined)
                .map(([label, value]) => (
                  <article key={label} className="border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">
                      {typeof value === 'number' ? value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : value}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3 text-sm font-medium text-gray-700">
            Bảng số liệu CSV ({csvRows.length - 1} dòng)
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-max text-left text-xs">
              <thead className="bg-gray-50 font-semibold text-gray-700">
                <tr>
                  {csvRows[0].map((heading, index) => (
                    <th key={`${heading}-${index}`} className="whitespace-nowrap px-3 py-2">
                      {heading || `Cột ${index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {csvRows.slice(1, 21).map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-gray-50">
                    {csvRows[0].map((_, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {row[cellIndex] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {executionLogs && (
          <section className="border border-gray-800 bg-gray-950 p-4 text-gray-100 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-400">
              <Terminal className="h-4 w-4 text-green-400" />
              <span>NHẬT KÝ THỰC THI &amp; ĐỐI SOÁT DATABASE (TERMINAL OUTPUT)</span>
            </div>
            <pre className="max-h-80 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-green-300">
              {executionLogs}
            </pre>
          </section>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout role="ADMIN" pageTitle="Trung tâm kiểm thử" stickyHeader>
      <div className="space-y-6">
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200" role="tablist" aria-label="Các khu vực kiểm thử">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => chooseTab(id)}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${
                tab === id ? 'border-red-600 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        {loadError && (
          <p role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </p>
        )}
        {csvError && (
          <p role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {csvError}
          </p>
        )}

        {tab === 'configuration' && (
          <div className="space-y-6">
            <div className="grid gap-5 xl:grid-cols-2">
              {/* Card 1: Chạy đo tải trực tiếp */}
              <section className="flex flex-col justify-between border border-gray-200 bg-white p-5 shadow-sm">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-gray-900">
                      1. Chạy Đo Tải Đa Mức / Tùy Chỉnh (POST /api/v1/register)
                    </h3>
                    <span className="bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Tối đa 3.000 VUs</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Bắn tải thật từ danh sách 3.000 sinh viên (`SV0001..SV3000`) vào Backend và tự động vẽ biểu đồ kết quả ngay bên dưới.
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {[
                      { label: 'Nhanh (10, 50, 100 VUs)', value: '10,50,100', cap: '3000' },
                      { label: '5 mức (10..1000 VUs)', value: '10,50,100,500,1000', cap: '3000' },
                      { label: 'Đầy đủ 7 mức (10..3000 VUs)', value: '10,50,100,500,1000,2000,3000', cap: '3000' },
                      { label: '2000 SV tranh 1000 chỗ', value: '2000', cap: '1000' },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setVuLevels(preset.value);
                          setClassCapacity(preset.cap);
                        }}
                        className={`border px-2.5 py-1 text-xs font-medium transition ${
                          vuLevels === preset.value && classCapacity === preset.cap
                            ? 'border-red-600 bg-red-50 text-red-700'
                            : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-700">
                      Các mức Virtual Users (VUs)
                      <input
                        type="text"
                        value={vuLevels}
                        onChange={(event) => setVuLevels(event.target.value)}
                        placeholder="VD: 10,50,100 hoặc 2000"
                        className="mt-1.5 w-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Sức chứa lớp (Capacity)
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        step={1}
                        value={classCapacity}
                        onChange={(event) => setClassCapacity(event.target.value)}
                        className="mt-1.5 w-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Thời gian tối đa (giây)
                      <input
                        type="number"
                        min={1}
                        max={86400}
                        step={1}
                        value={durationSeconds}
                        onChange={(event) => setDurationSeconds(event.target.value)}
                        className="mt-1.5 w-full border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-sm font-medium text-gray-700">
                      Lớp học phần mục tiêu
                      <select
                        value={targetClassId}
                        onChange={(event) => setTargetClassId(event.target.value)}
                        disabled={loading || courses.length === 0}
                        className="mt-1.5 w-full border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400"
                      >
                        {courses.length === 0 && <option value="">Không có lớp học phần</option>}
                        {courses.map((course) => (
                          <option key={course.course_class_id} value={course.course_class_id}>
                            {course.class_code} · {course.course_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleRunLoadTest}
                    disabled={runningMode !== 'none' || !vuLevels.trim()}
                    className="inline-flex items-center gap-2 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runningMode === 'loadtest' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Đang bắn tải thật...
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" /> Chạy đo tải ngay
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={exportConfiguration}
                    disabled={!targetClassId}
                    className="inline-flex items-center gap-2 border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> Tải JSON
                  </button>
                </div>
              </section>

              {/* Card 2: Chạy 5 kịch bản nghiệm thu KT1, KT2, KT3, KT4, KT5 */}
              <section className="flex flex-col justify-between border border-gray-200 bg-white p-5 shadow-sm">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-gray-900">
                      2. Chạy 5 Kịch Bản Nghiệm Thu (KT1 · KT2 · KT3 · KT4 · KT5)
                    </h3>
                    <span className="bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Kiểm chứng Invariants</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Tự động kiểm tra 5 trường hợp cốt lõi: Đăng ký hợp lệ (KT1), Tranh chỗ cuối (KT2), Gửi lặp trùng (KT3), Chặn trùng lịch (KT4) và Hủy hoàn chỗ &amp; Tranh chỗ vừa nhả (KT5).
                  </p>

                  <div className="mt-4 space-y-2 border border-gray-100 bg-gray-50 p-3 text-xs text-gray-700">
                    <div>
                      <strong>• KT1:</strong> 1 SV hợp lệ đăng ký khi lớp còn 50 chỗ → Thêm đúng 1 đăng ký, giảm đúng 1 chỗ (`49/50`).
                    </div>
                    <div>
                      <strong>• KT2:</strong> Nhiều SV gửi đồng thời tranh 1 chỗ cuối → Chỉ 1 SV thành công (`200`), còn lại nhận `409 CLASS_FULL`.
                    </div>
                    <div>
                      <strong>• KT3:</strong> Cùng 1 SV gửi lặp yêu cầu → Không tạo đăng ký trùng, không trừ thêm chỗ.
                    </div>
                    <div>
                      <strong>• KT4:</strong> SV đang học Thứ 2 tiết 1–3 đăng ký lớp Thứ 2 tiết 2–4 → Chặn 100% `409 SCHEDULE_CONFLICT`.
                    </div>
                    <div>
                      <strong>• KT5:</strong> Lớp đã đầy (`10/10`), 1 SV gọi `DELETE` hủy nhả 1 chỗ → Nhiều SV ngoài đua `POST` tranh chỗ đó → Chỉ 1 SV lấy được chỗ, giữ chuẩn `10/10`.
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs font-medium text-gray-700">
                      Số SV tranh chỗ cuối (KT2)
                      <input
                        type="number"
                        min={2}
                        max={3000}
                        value={competingStudents}
                        onChange={(event) => setCompetingStudents(event.target.value)}
                        className="mt-1 w-full border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Số request gửi lặp (KT3)
                      <input
                        type="number"
                        min={2}
                        max={500}
                        value={repeatedRequests}
                        onChange={(event) => setRepeatedRequests(event.target.value)}
                        className="mt-1 w-full border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Số SV trùng lịch (KT4)
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={conflictStudents}
                        onChange={(event) => setConflictStudents(event.target.value)}
                        className="mt-1 w-full border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Số SV tranh chỗ hủy (KT5)
                      <input
                        type="number"
                        min={2}
                        max={2000}
                        value={regrabStudents}
                        onChange={(event) => setRegrabStudents(event.target.value)}
                        className="mt-1 w-full border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-red-400"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-5 pt-2">
                  <button
                    type="button"
                    onClick={handleRunAcceptanceTests}
                    disabled={runningMode !== 'none'}
                    className="inline-flex items-center gap-2 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runningMode === 'kt' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Đang chạy KT1 – KT5...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" /> Chạy kiểm thử KT1 – KT5 ngay
                      </>
                    )}
                  </button>
                </div>
              </section>
            </div>

            {/* Hiển thị kết quả ngay tại chỗ sau khi chạy */}
            {renderResultsDashboard()}
          </div>
        )}

        {tab === 'results' && (
          <div className="space-y-5">
            <section className="border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-gray-900">Kết quả và lịch sử kiểm thử</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Bạn có thể chạy trực tiếp ở tab &ldquo;Chạy kiểm thử trực tiếp&rdquo; hoặc nhập tệp CSV có sẵn tại đây.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    <FileUp className="h-4 w-4" /> Nhập CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      onChange={(event) => importCsv(event.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={exportMarkdownReport}
                    disabled={!csv && !activeReport}
                    className="inline-flex items-center gap-2 border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4 text-blue-600" /> Xuất Markdown (.md)
                  </button>
                  <button
                    type="button"
                    onClick={exportHtmlReport}
                    disabled={!csv && !activeReport}
                    className="inline-flex items-center gap-2 border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileCode2 className="h-4 w-4 text-purple-600" /> Xuất Báo Cáo HTML
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={!csv}
                    className="inline-flex items-center gap-2 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> Xuất CSV
                  </button>
                </div>
              </div>
            </section>

            {csvRows.length ? (
              renderResultsDashboard()
            ) : (
              <div className="border border-dashed border-gray-200 bg-white p-12 text-center">
                <FlaskConical className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-3 font-medium text-gray-700">Chưa có dữ liệu kết quả kiểm thử</p>
                <p className="mt-1 text-xs text-gray-500">
                  Hãy bấm chạy ở tab &ldquo;Chạy kiểm thử trực tiếp&rdquo; hoặc nhấn &ldquo;Nhập CSV&rdquo; để xem biểu đồ.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
