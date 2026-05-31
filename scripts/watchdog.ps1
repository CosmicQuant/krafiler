$BackendUrl = "http://localhost:3001/health"
$LogFile = "$PSScriptRoot\..\backend\logs\watchdog.log"
$BackendDir = "$PSScriptRoot\..\backend"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log "Watchdog started — checking $BackendUrl every 15s"

while ($true) {
    Start-Sleep -Seconds 15
    try {
        $response = Invoke-WebRequest -Uri $BackendUrl -TimeoutSec 5 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            # healthy
            continue
        }
        Log "Backend returned status $($response.StatusCode) — unhealthy"
    } catch {
        Log "Backend unreachable ($($_.Exception.Message)) — restarting..."
        # Kill any node processes holding port 3001
        $procs = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue |
                 Select-Object -ExpandProperty OwningProcess
        foreach ($pid in $procs) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Log "Killed PID $pid"
        }
        Start-Sleep -Seconds 2
        # Start backend from WSL
        $wslCmd = "cmd.exe /c 'start /B npm run dev:backend'"
        wsl -e bash -c "$wslCmd" | Out-Null
        Log "Backend restart initiated"
        # Give it time to start
        Start-Sleep -Seconds 10
    }
}
