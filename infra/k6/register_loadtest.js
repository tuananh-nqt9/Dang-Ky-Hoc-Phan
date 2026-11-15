import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const VUS = Number(__ENV.VUS || 10);
const ITERATIONS = Number(__ENV.ITERATIONS || 1000);
const MAX_DURATION = __ENV.MAX_DURATION || '120s';
const API_BASE_URL = (__ENV.API_BASE_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
const COURSE_CLASS_ID = __ENV.COURSE_CLASS_ID || 'LHP001';
const TOKENS_FILE = __ENV.TOKENS_FILE || '../../exports/loadtest_tokens.json';
const SUMMARY_FILE = __ENV.SUMMARY_FILE || '';

const successfulRequests = new Counter('dkhp_successful_requests');
const failedRequests = new Counter('dkhp_failed_requests');

const tokenPool = new SharedArray('dkhp_loadtest_tokens', function () {
  const raw = JSON.parse(open(TOKENS_FILE));
  if (!raw || !Array.isArray(raw.tokens) || raw.tokens.length === 0) {
    throw new Error(`File token không hợp lệ hoặc rỗng: ${TOKENS_FILE}`);
  }
  return raw.tokens;
});

export const options = {
  scenarios: {
    registration_rush: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: ITERATIONS,
      maxDuration: MAX_DURATION,
      gracefulStop: '10s',
    },
  },
};

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function () {
  const idx = exec.scenario.iterationInTest % tokenPool.length;
  const student = tokenPool[idx];

  const payload = JSON.stringify({
    student_id: student.student_id,
    course_class_id: COURSE_CLASS_ID,
  });

  const params = {
    headers: {
      Authorization: `Bearer ${student.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': uuidv4(),
    },
    timeout: '30s',
  };

  const response = http.post(`${API_BASE_URL}/register`, payload, params);

  const isSuccess = check(response, {
    'status is 200 or 201 REGISTERED': (r) => r.status === 200 || r.status === 201,
  });

  if (isSuccess) {
    successfulRequests.add(1);
  } else {
    failedRequests.add(1);
  }
}

export function handleSummary(data) {
  const totalReqs = data.metrics.http_reqs?.values?.count || 0;
  const successReqs = data.metrics.dkhp_successful_requests?.values?.count || 0;
  const failReqs = data.metrics.dkhp_failed_requests?.values?.count || Math.max(0, totalReqs - successReqs);
  const successRate = totalReqs > 0 ? Number(((successReqs / totalReqs) * 100).toFixed(2)) : 0;
  const avgMs = Number((data.metrics.http_req_duration?.values?.avg || 0).toFixed(2));
  const p95Ms = Number((data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2));
  const p99Ms = Number(
    (
      data.metrics.http_req_duration?.values?.['p(99)'] ??
      data.metrics.http_req_duration?.values?.max ??
      0
    ).toFixed(2),
  );
  const rps = Number((data.metrics.http_reqs?.values?.rate || 0).toFixed(2));
  const durationSec = Math.max(
    1,
    Math.round((data.state?.testRunDurationMs || 1000) / 1000),
  );

  const summaryObj = {
    run_at: `${VUS} VUs (${new Date().toTimeString().slice(0, 8)})`,
    vus: VUS,
    iterations: ITERATIONS,
    duration_seconds: durationSec,
    total_requests: totalReqs,
    successful_requests: successReqs,
    failed_requests: failReqs,
    success_rate_percent: successRate,
    avg_response_time_ms: avgMs,
    p95_ms: p95Ms,
    p99_ms: p99Ms,
    rps: rps,
  };

  const outputs = {
    stdout: `\n[K6 SUMMARY] VUs=${VUS} | Total=${totalReqs} | Success=${successReqs} (${successRate}%) | Failed=${failReqs} | Avg=${avgMs}ms | P95=${p95Ms}ms | P99=${p99Ms}ms | RPS=${rps}\n`,
  };

  if (SUMMARY_FILE) {
    outputs[SUMMARY_FILE] = JSON.stringify(summaryObj, null, 2);
  }

  return outputs;
}
