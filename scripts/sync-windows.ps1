param([string]$ProjectPath=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$env:GIT_TERMINAL_PROMPT='0'
$env:GCM_INTERACTIVE='Never'
$state=Join-Path $ProjectPath '.sync'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$log=Join-Path $state 'sync.log'
function Write-Log([string]$Message) {
  $line="$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Output $line
}
function Invoke-Git([string[]]$Arguments) {
  $preference=$ErrorActionPreference
  $ErrorActionPreference="Continue"
  $output=& git -c core.quotepath=false -C $ProjectPath @Arguments 2>&1
  $code=$LASTEXITCODE
  $ErrorActionPreference=$preference
  if($code -ne 0){throw ($output -join "`n")}
  return $output
}
$mutex=New-Object System.Threading.Mutex($false,'Local\RoleDaExtensaoPROEXSync')
$held=$false
try {
  $held=$mutex.WaitOne(0)
  if(-not $held){exit 0}
  if((Test-Path $log) -and (Get-Item $log).Length -gt 1048576){Move-Item $log ($log+'.previous') -Force}
  $origin=(Invoke-Git -Arguments @('remote','get-url','origin') | Out-String).Trim()
  if($origin -ne 'https://github.com/yandiamantinoBr/role-da-extensao-proex-ufg.git'){throw 'O origin nao corresponde ao repositorio autorizado.'}
  $branch=(Invoke-Git -Arguments @('branch','--show-current') | Out-String).Trim()
  if($branch -ne 'main'){throw 'A sincronizacao automatica opera apenas na branch main.'}
  $gitDir=Join-Path $ProjectPath '.git'
  if((Test-Path (Join-Path $gitDir 'MERGE_HEAD')) -or (Test-Path (Join-Path $gitDir 'rebase-merge')) -or (Test-Path (Join-Path $gitDir 'rebase-apply'))){throw 'Ha uma operacao Git em andamento. Resolva-a antes da sincronizacao.'}
  $changed=@(Invoke-Git -Arguments @('status','--porcelain'))
  if($changed.Count -gt 0) {
    # Do not capture a file while an editor is still saving it.
    $paths=@(Invoke-Git -Arguments @('ls-files','--modified','--others','--exclude-standard'))
    foreach($path in $paths){$file=Join-Path $ProjectPath $path;if((Test-Path $file -PathType Leaf) -and (Get-Item $file).LastWriteTime -gt (Get-Date).AddSeconds(-15)){Write-Log 'Aguardando o fim da edicao dos arquivos.';exit 0}}
    Invoke-Git -Arguments @('add','-A') | Out-Null
    & git -C $ProjectPath diff --cached --quiet
    if($LASTEXITCODE -eq 1){Invoke-Git -Arguments @('commit','-m',"Atualizacao local: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')") | Out-Null}
    elseif($LASTEXITCODE -ne 0){throw 'Nao foi possivel conferir as alteracoes.'}
  }
  Invoke-Git -Arguments @('fetch','origin','main') | Out-Null
  $counts=((Invoke-Git -Arguments @('rev-list','--left-right','--count','HEAD...origin/main') | Out-String).Trim() -split '\s+')
  $ahead=[int]$counts[0];$behind=[int]$counts[1]
  if($behind -gt 0 -and $ahead -eq 0){Invoke-Git -Arguments @('merge','--ff-only','origin/main') | Out-Null}
  elseif($behind -gt 0 -and $ahead -gt 0){
    try{Invoke-Git -Arguments @('merge','--no-edit','origin/main') | Out-Null}
    catch{& git -C $ProjectPath merge --abort 2>&1 | Out-Null;throw 'Conflito entre edicoes locais e GitHub. Seus commits foram preservados; sincronizacao pausada ate resolver o conflito.'}
  }
  Invoke-Git -Arguments @('push','origin','main') | Out-Null
  $head=(Invoke-Git -Arguments @('rev-parse','HEAD') | Out-String).Trim()
  Set-Content -Path (Join-Path $state 'last-success.txt') -Value "$(Get-Date -Format o) $head" -Encoding UTF8
  Write-Log "Sincronizado: $head"
} catch {
  Write-Log "ERRO: $($_.Exception.Message)"
  exit 1
} finally {
  if($held){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}
