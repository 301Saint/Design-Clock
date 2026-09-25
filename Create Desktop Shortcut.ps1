# Creates a "Design Clock" shortcut on your desktop (and in the Start menu).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Design Clock.lnk'))
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = "`"$here\Design Clock.vbs`""
  $lnk.WorkingDirectory = $here
  $lnk.IconLocation = "$here\assets\design-clock.ico,0"
  $lnk.Description = 'Design time tracker'
  $lnk.Save()
}
Write-Host 'Shortcut created on the Desktop and in the Start menu.'
