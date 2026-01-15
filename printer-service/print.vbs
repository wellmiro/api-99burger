
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
strFile = "C:\printer-service\\cupom.txt"

Set objFile = objFSO.OpenTextFile(strFile, 1)
strText = objFile.ReadAll
objFile.Close

Set objNotepad = CreateObject("WScript.Shell")
Set objExec = CreateObject("WScript.Shell")

' Cria Notepad invisível
Set obj = CreateObject("WScript.Shell")
obj.Run "notepad.exe " & Chr(34) & strFile & Chr(34), 0, True

' Aguarda abrir
WScript.Sleep 500

' Imprime
obj.SendKeys "^p"
WScript.Sleep 500
obj.SendKeys "{ENTER}"
WScript.Sleep 500
obj.SendKeys "^w"
