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


; v1.509.0: окно установщика ЦЕЛИКОМ на экране.
;
; Владелец прислал снимок: мастер установки открылся так, что кнопки «Готово»
; не видно — она ушла под нижний край. Замер: экран 1920x1080, панель задач
; съедает 48 пикселей снизу, а окно 503x390 открылось в точке 778,783 — низ на
; 141 пиксель за краем. Нажать нечего, и установку не завершить.
;
; NSIS ставит окно сам и про рабочую область не знает. Поэтому здесь окно
; двигается в середину РАБОЧЕЙ ОБЛАСТИ (без панели задач) — и, если бы оно всё
; равно не поместилось, прижимается к её краю, а не свисает наружу.
;
; КУДА ЭТО ВЕШАЕТСЯ И ПОЧЕМУ ИМЕННО СЮДА. Пробовал двумя другими способами, и
; оба неверные:
;   • !macro customHeader — сборщик вставляет его ПОСЛЕ языков MUI, а язык тянет
;     за собой создание окна. Настройка, объявленная там, уже никуда не попадает:
;     makensis честно ругался «install function not referenced».
;   • Своя Function .onGUIInit — «Function named .onGUIInit already exists»: её
;     пишет сам MUI.
; А этот файл подключается ДО языков, поэтому настройка объявляется прямо здесь,
; на верхнем уровне, и MUI зовёт нашу функцию из своего .onGUIInit.
!define MUI_CUSTOMFUNCTION_GUIINIT ponoiCenterWindow

Function ponoiCenterWindow
  ; Рабочая область: SPI_GETWORKAREA (0x0030) даёт прямоугольник без панели задач.
  System::Call '*(i,i,i,i)p.r1'
  System::Call 'user32::SystemParametersInfoW(i 0x0030, i 0, p r1, i 0)'
  System::Call '*$1(i.r2,i.r3,i.r4,i.r5)'
  System::Free $1

  ; Своё окно.
  System::Call '*(i,i,i,i)p.r6'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r6)'
  System::Call '*$6(i.r7,i.r8,i.r9,i.R0)'
  System::Free $6

  IntOp $R1 $9 - $7        ; ширина окна
  IntOp $R2 $R0 - $8       ; высота окна
  IntOp $R3 $4 - $2        ; ширина рабочей области
  IntOp $R4 $5 - $3        ; высота рабочей области

  ; Середина по горизонтали, но не левее края.
  IntOp $R5 $R3 - $R1
  IntOp $R5 $R5 / 2
  IntOp $R5 $R5 + $2
  IntCmp $R5 $2 0 0 +2
  StrCpy $R5 $2

  ; Середина по вертикали, но не выше края.
  IntOp $R6 $R4 - $R2
  IntOp $R6 $R6 / 2
  IntOp $R6 $R6 + $3
  IntCmp $R6 $3 0 0 +2
  StrCpy $R6 $3

  ; 0x0005 = SWP_NOSIZE | SWP_NOZORDER: только переставить, не трогая размер.
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i $R5, i $R6, i 0, i 0, i 0x0005)'
FunctionEnd
