param([Parameter(Mandatory=$true)][int]$RootProcessId)
$ErrorActionPreference='Stop'
function Read-Tree {
    $root=Get-Process -Id $RootProcessId
    $inventory=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate
    $ids=[Collections.Generic.HashSet[int]]::new()
    $created=[Collections.Generic.Dictionary[int,datetime]]::new()
    [void]$ids.Add($RootProcessId)
    $created[$RootProcessId]=$root.StartTime
    do {
        $added=$false
        # Parent IDs can refer to an exited process whose ID Windows reused for
        # our new root. Such older orphaned processes are NOT descendants.
        foreach($entry in $inventory){
            $parent=[int]$entry.ParentProcessId
            if($ids.Contains($parent) -and $null -ne $entry.CreationDate -and $entry.CreationDate -ge $created[$parent] -and $ids.Add([int]$entry.ProcessId)){
                $created[[int]$entry.ProcessId]=$entry.CreationDate
                $added=$true
            }
        }
    } while($added)
    $rows=@(foreach($identifier in $ids){
        $process=Get-Process -Id $identifier -ErrorAction SilentlyContinue
        if($null -ne $process){[pscustomobject]@{id=$identifier;start=$process.StartTime.ToUniversalTime().Ticks;cpuMs=$process.TotalProcessorTime.TotalMilliseconds;workingSetBytes=$process.WorkingSet64;privateBytes=$process.PrivateMemorySize64}}
    })
    [pscustomobject]@{timestamp=[Diagnostics.Stopwatch]::GetTimestamp();rows=$rows}
}
$first=Read-Tree
Start-Sleep -Seconds 2
$second=Read-Tree
$elapsedMs=1000*($second.timestamp-$first.timestamp)/[Diagnostics.Stopwatch]::Frequency
$stable=(@($first.rows.id | Sort-Object) -join ',') -eq (@($second.rows.id | Sort-Object) -join ',')
$cpuMs=0
foreach($row in $second.rows){
    $old=$first.rows | Where-Object {$_.id -eq $row.id -and $_.start -eq $row.start}
    if($null -eq $old -or $row.cpuMs -lt $old.cpuMs){$stable=$false}else{$cpuMs+=$row.cpuMs-$old.cpuMs}
}
[pscustomobject]@{
    workingSetBytes=($second.rows | Measure-Object workingSetBytes -Sum).Sum
    privateBytes=($second.rows | Measure-Object privateBytes -Sum).Sum
    processCount=$second.rows.Count
    pids=$second.rows.id
    sampleMs=$elapsedMs
    stableProcessTree=$stable
    cpuPercentOfOneCore=$(if($stable){100*$cpuMs/$elapsedMs}else{$null})
    logicalProcessors=[Environment]::ProcessorCount
} | ConvertTo-Json -Compress
