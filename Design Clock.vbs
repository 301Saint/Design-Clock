' Starts Design Clock without a console window and opens it as an app window.
' If it is already running, this just opens another window onto it.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

node = "node"
pf = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If fso.FileExists(pf) Then node = """" & pf & """"

If Not fso.FolderExists(here & "\dist") Then
  sh.Run "cmd /c npm run build", 1, True
End If
sh.Run node & " server\index.ts --open", 0, False
