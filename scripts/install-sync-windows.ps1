param([string]$ProjectPath=(Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference='Stop'
$taskName='Role da Extensao - sincronizar GitHub'
$script=Join-Path $ProjectPath 'scripts\sync-windows.ps1'
$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -ProjectPath `"$ProjectPath`""
$timer=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$logon=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($timer,$logon) -Principal $principal -Settings $settings -Description 'Sincroniza somente a pasta do Role da Extensao com seu repositorio publico. Preserva commits quando ha conflitos.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Sincronizacao instalada a cada 2 minutos e ao entrar no Windows: $taskName"
