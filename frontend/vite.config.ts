import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function runPythonScript(scriptRelativePath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const fullScriptPath = path.resolve(repoRoot, scriptRelativePath)
    const cmd = process.platform === 'win32' ? 'py' : 'python3'
    const cmdArgs = process.platform === 'win32' ? ['-3.11', fullScriptPath, ...args] : [fullScriptPath, ...args]

    const child = spawn(cmd, cmdArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}`.trim() })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function localTestingRunnerPlugin(): Plugin {
  return {
    name: 'local-testing-runner',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__local_testing/')) {
          next()
          return
        }

        try {
          if (req.method === 'POST' && req.url === '/__local_testing/run-loadtest') {
            const raw = await readRequestBody(req)
            const body = (raw ? JSON.parse(raw) : {}) as {
              levels?: string
              capacity?: number
            }

            const rawLevels = String(body.levels || '10,50,100')
            const cleanLevels = rawLevels
              .split(',')
              .map((item) => Number.parseInt(item.trim(), 10))
              .filter((num) => Number.isInteger(num) && num >= 1 && num <= 3000)

            if (cleanLevels.length === 0) {
              sendJson(res, 400, { ok: false, message: 'Danh sách mức VUs không hợp lệ (1..3000).' })
              return
            }

            const capacity = Number.isInteger(Number(body.capacity)) && Number(body.capacity) >= 1
              ? Math.min(10000, Number(body.capacity))
              : 3000

            const execResult = await runPythonScript('backend/scripts/run_loadtest_csv.py', [
              '--levels',
              cleanLevels.join(','),
              '--capacity',
              String(capacity),
            ])

            const csvPath = path.resolve(__dirname, 'sample-load-test-results.csv')
            const reportPath = path.resolve(__dirname, 'loadtest_detailed_report.json')
            const csv = await fs.readFile(csvPath, 'utf-8').catch(() => '')
            const rawReport = await fs.readFile(reportPath, 'utf-8').catch(() => '')
            const report = rawReport ? JSON.parse(rawReport) : null

            if (execResult.code !== 0 || !csv) {
              sendJson(res, 500, {
                ok: false,
                message: 'Thực thi đo tải thất bại. Vui lòng kiểm tra Backend (port 8080) và PostgreSQL (port 5432).',
                logs: `${execResult.stdout}\n${execResult.stderr}`.trim(),
              })
              return
            }

            sendJson(res, 200, {
              ok: true,
              csv,
              report,
              logs: execResult.stdout.trim(),
            })
            return
          }

          if (req.method === 'POST' && req.url === '/__local_testing/run-kt') {
            const raw = await readRequestBody(req)
            const body = (raw ? JSON.parse(raw) : {}) as {
              competing_students?: number
              repeated_requests?: number
              conflict_students?: number
              regrab_students?: number
            }

            const competing = Math.max(2, Math.min(3000, Number(body.competing_students) || 50))
            const repeated = Math.max(2, Math.min(500, Number(body.repeated_requests) || 50))
            const conflict = Math.max(1, Math.min(1000, Number(body.conflict_students) || 20))
            const regrab = Math.max(2, Math.min(2000, Number(body.regrab_students) || 30))

            const execResult = await runPythonScript('backend/scripts/run_kt1_kt2_kt3.py', [
              '--competing-students',
              String(competing),
              '--duplicate-requests',
              String(repeated),
              '--conflict-students',
              String(conflict),
              '--regrab-students',
              String(regrab),
            ])

            const csvPath = path.resolve(__dirname, 'kt1_kt2_kt3_results.csv')
            const reportPath = path.resolve(__dirname, 'kt_detailed_report.json')
            const csv = await fs.readFile(csvPath, 'utf-8').catch(() => '')
            const rawReport = await fs.readFile(reportPath, 'utf-8').catch(() => '')
            const report = rawReport ? JSON.parse(rawReport) : null

            if (execResult.code !== 0 || !csv) {
              sendJson(res, 500, {
                ok: false,
                message: 'Thực thi bộ kịch bản KT1–KT5 thất bại.',
                logs: `${execResult.stdout}\n${execResult.stderr}`.trim(),
              })
              return
            }

            sendJson(res, 200, {
              ok: true,
              csv,
              report,
              logs: execResult.stdout.trim(),
            })
            return
          }

          if (req.method === 'GET' && req.url === '/__local_testing/latest-reports') {
            const ktCsv = await fs.readFile(path.resolve(__dirname, 'kt1_kt2_kt3_results.csv'), 'utf-8').catch(() => '')
            const ltCsv = await fs.readFile(path.resolve(__dirname, 'sample-load-test-results.csv'), 'utf-8').catch(() => '')
            const ktRaw = await fs.readFile(path.resolve(__dirname, 'kt_detailed_report.json'), 'utf-8').catch(() => '')
            const ltRaw = await fs.readFile(path.resolve(__dirname, 'loadtest_detailed_report.json'), 'utf-8').catch(() => '')
            sendJson(res, 200, {
              ok: true,
              kt_csv: ktCsv,
              loadtest_csv: ltCsv,
              kt_report: ktRaw ? JSON.parse(ktRaw) : null,
              loadtest_report: ltRaw ? JSON.parse(ltRaw) : null,
            })
            return
          }

          sendJson(res, 404, { ok: false, message: 'Endpoint không tồn tại.' })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            message: error instanceof Error ? error.message : 'Lỗi máy chủ thực thi kiểm thử.',
          })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), localTestingRunnerPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
