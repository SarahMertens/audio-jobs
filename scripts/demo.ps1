# Helper functions for testing and demoing the API from PowerShell.
# Load them in the current window with:  . .\scripts\demo.ps1

$ApiUrl = "http://localhost:3000"

function Start-TestJob {
  param([string]$File, [int]$ResultCount = 3)

  $upload = curl.exe -s -F "file=@$File" "$ApiUrl/uploads" | ConvertFrom-Json
  if (-not $upload.audioId) { Write-Host "Upload failed: $($upload.error.code)"; return }

  $body = @{ audioId = $upload.audioId; resultCount = $ResultCount } | ConvertTo-Json -Compress
  $job = $body | curl.exe -s -H "Content-Type: application/json" --data-binary "@-" "$ApiUrl/jobs" | ConvertFrom-Json
  return $job.jobId
}

function Watch-Job {
  param([string]$JobId, [int]$MaxSeconds = 60)

  $last = ""
  for ($i = 0; $i -lt $MaxSeconds * 2; $i++) {
    $job = Invoke-RestMethod "$ApiUrl/jobs/$JobId"
    $line = "{0,-10} {1,3}%  attempt {2}/{3}" -f $job.status, $job.progress, $job.attempts, $job.maxAttempts
    if ($job.retry) {
      $next = ([datetime]$job.retry.nextRetryAt).ToString("HH:mm:ss")
      $line += "  last error: $($job.retry.lastError.code), next try at $next"
    }
    if ($job.error) { $line += "  error: $($job.error.code)" }

    # Only print when something changed, so the retry steps stand out.
    if ($line -ne $last) { "{0}  {1}" -f (Get-Date).ToString("HH:mm:ss"), $line; $last = $line }
    if ($job.status -in "completed", "failed") { break }
    Start-Sleep -Milliseconds 500
  }
}

function Show-Attempts {
  param([string]$JobId)
  (Invoke-RestMethod "$ApiUrl/jobs/$JobId/attempts").attempts |
    Select-Object attempt, status, @{ n = "error"; e = { $_.error.code } }, durationMs |
    Format-Table
}

function Show-Results {
  param([string]$JobId)
  (Invoke-RestMethod "$ApiUrl/jobs/$JobId/results").results | Format-Table
}

function Show-DeadLetters {
  (Invoke-RestMethod "$ApiUrl/jobs?status=failed").jobs |
    Select-Object @{ n = "file"; e = { $_.audio.fileName } }, attempts, @{ n = "error"; e = { $_.error.code } }, finishedAt |
    Format-Table
}