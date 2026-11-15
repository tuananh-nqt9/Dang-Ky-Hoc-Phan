param(
    [int[]]$VuLevels = @(10, 50, 100, 500, 1000, 2000, 3000),
    [int]$MaxStudents = 3000,
    [string]$ComposeFile = "compose.dev.yml",
    [switch]$KeepLoadtestMode
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

New-Item -ItemType Directory -Force -Path "$RepoRoot\exports" | Out-Null

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  [1/4] CHUAN BI MOI TRUONG VA $MaxStudents TOKEN CHO K6" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Reset DB sang che do loadtest va tao token trong container api
docker compose -f $ComposeFile exec -T api python -m scripts.reset_lab --confirm-lab-reset --clear-sessions --reseed loadtest --student-count $MaxStudents
docker compose -f $ComposeFile exec -T api python -m scripts.prepare_tokens --count $MaxStudents --output /tmp/loadtest_tokens.json

# 2. Sao chep file token tu container ra may host (exports/loadtest_tokens.json)
$ApiContainerId = (docker compose -f $ComposeFile ps -q api).Trim()
docker cp "${ApiContainerId}:/tmp/loadtest_tokens.json" "$RepoRoot\exports\loadtest_tokens.json"
Write-Host "[OK] Da xuat $MaxStudents token ra: exports\loadtest_tokens.json" -ForegroundColor Green

# 3. Kiem tra k6 cai truc tiep tren Windows hay chay qua Docker image grafana/k6
$LocalK6 = Get-Command k6 -ErrorAction SilentlyContinue
if ($LocalK6) {
    Write-Host "[INFO] Su dung k6 cai tren Windows: $($LocalK6.Source)" -ForegroundColor Yellow
} else {
    Write-Host "[INFO] May chua cai k6 CLI, tu dong chay qua Docker image grafana/k6:latest..." -ForegroundColor Yellow
}

$CsvRows = @()

try {
    foreach ($vus in $VuLevels) {
        $iterations = $vus
        Write-Host ""
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan
        Write-Host "  [2/4] DANG CHAY K6: VUs = $vus | Iterations = $iterations" -ForegroundColor Cyan
        Write-Host "-----------------------------------------------------------------" -ForegroundColor Cyan

        # Reset trang thai lop LHP001 truoc moi luot chay (giu nguyen bang sessions)
        docker compose -f $ComposeFile exec -T api python -m scripts.reset_lab --confirm-lab-reset --reseed loadtest --student-count $MaxStudents

        # Mo rong capacity cua LHP001 theo so luong sinh vien test
        $cap = [Math]::Max(1000, $vus)
        docker compose -f $ComposeFile exec -T postgres psql -U dkhp_user -d dkhp_dev -c "UPDATE course_classes SET capacity = $cap, remaining_seats = $cap WHERE course_class_id = 'LHP001';" | Out-Null

        $SummaryHostPath = "$RepoRoot\exports\k6_summary_${vus}.json"
        if (Test-Path $SummaryHostPath) { Remove-Item $SummaryHostPath -Force }

        if ($LocalK6) {
            & k6 run `
                --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" `
                -e VUS=$vus `
                -e ITERATIONS=$iterations `
                -e API_BASE_URL="http://localhost:8080/api/v1" `
                -e TOKENS_FILE="../../exports/loadtest_tokens.json" `
                -e SUMMARY_FILE="exports/k6_summary_${vus}.json" `
                "$RepoRoot\infra\k6\register_loadtest.js"
        } else {
            docker run --rm `
                -v "${RepoRoot}:/work" `
                -w /work `
                grafana/k6:latest run `
                --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" `
                -e VUS=$vus `
                -e ITERATIONS=$iterations `
                -e API_BASE_URL="http://host.docker.internal:8080/api/v1" `
                -e TOKENS_FILE="/work/exports/loadtest_tokens.json" `
                -e SUMMARY_FILE="/work/exports/k6_summary_${vus}.json" `
                /work/infra/k6/register_loadtest.js
        }

        Write-Host "[CHECK INVARIANTS] Doi soat tinh toan ven du lieu PostgreSQL sau muc $vus VUs:" -ForegroundColor Gray
        docker compose -f $ComposeFile exec -T api python -m scripts.check_invariants

        if (Test-Path $SummaryHostPath) {
            $item = Get-Content $SummaryHostPath -Raw | ConvertFrom-Json
            $CsvRows += $item
        }
    }

    if ($CsvRows.Count -gt 0) {
        $CsvHeader = "run_at,vus,iterations,duration_seconds,total_requests,successful_requests,failed_requests,success_rate_percent,avg_response_time_ms,p95_ms,p99_ms,rps"
        $CsvLines = @($CsvHeader)
        foreach ($r in $CsvRows) {
            $CsvLines += "$($r.run_at),$($r.vus),$($r.iterations),$($r.duration_seconds),$($r.total_requests),$($r.successful_requests),$($r.failed_requests),$($r.success_rate_percent),$($r.avg_response_time_ms),$($r.p95_ms),$($r.p99_ms),$($r.rps)"
        }
        $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllLines("$RepoRoot\frontend\sample-load-test-results.csv", $CsvLines, $Utf8NoBom)
        [System.IO.File]::WriteAllLines("$RepoRoot\frontend\public\sample-load-test-results.csv", $CsvLines, $Utf8NoBom)
        Write-Host ""
        Write-Host "[3/4] Da xuat ket qua do tai k6 ra file: frontend\sample-load-test-results.csv" -ForegroundColor Green
    }
} finally {
    if (-not $KeepLoadtestMode) {
        Write-Host ""
        Write-Host "[4/4] Khoi phuc du lieu mau 3 lop (--mode ui) cho giao dien..." -ForegroundColor Cyan
        docker compose -f $ComposeFile exec -T api python -m scripts.reset_lab --confirm-lab-reset --reseed ui --student-count $MaxStudents
    }
}

Write-Host ""
Write-Host "[HOAN TAT] Mo http://localhost:5173/admin/testing?tab=results va bam 'Nhap CSV' de xem bieu do k6!" -ForegroundColor Green
