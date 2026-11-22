param([Parameter(Mandatory = $true)][string]$Path)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($Path, $false, $true)
    Write-Output $doc.Content.Text
}
finally {
    if ($doc -ne $null) {
        try { $doc.Close($false) } catch { }
    }
    if ($word -ne $null) {
        try { $word.Quit() } catch { }
        try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch { }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
