; v1.47.1: установщик сам закрывает работающий Ponoi —
; больше никаких «Не удалось закрыть Ponoi. Закройте вручную и нажмите Повторить».
!macro customInit
  nsExec::Exec 'taskkill /F /IM Ponoi.exe /T'
  Sleep 300
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM Ponoi.exe /T'
  Sleep 300
!macroend
