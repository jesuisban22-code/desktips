@echo off
setlocal
cd /d "%~dp0"
title Bureau

REM  Ouvre Bureau, ou explique ce qu'il manque. Rien d'autre.

REM  Fermer Bureau le MASQUE au lieu de le quitter : c'est voulu, c'est un
REM  moniteur. Mais apres une reinstallation, l'ancienne version tourne encore
REM  et c'est elle que tu regardes. Rien ne distingue ca d'un bug.
taskkill /IM bureau.exe /F >nul 2>&1
taskkill /IM Bureau.exe /F >nul 2>&1

set EXE=
REM  L'installeur NSIS "utilisateur courant" pose Bureau dans %LOCALAPPDATA%\Bureau,
REM  pas dans ...\Programs\Bureau : ce fichier ne le trouvait jamais et lancait
REM  la copie de compilation a la place.
if exist "%LOCALAPPDATA%\Bureau\bureau.exe"  set EXE=%LOCALAPPDATA%\Bureau\bureau.exe
if not defined EXE if exist "%LOCALAPPDATA%\Programs\Bureau\Bureau.exe"  set EXE=%LOCALAPPDATA%\Programs\Bureau\Bureau.exe
if not defined EXE if exist "%PROGRAMFILES%\Bureau\Bureau.exe"       set EXE=%PROGRAMFILES%\Bureau\Bureau.exe
if not defined EXE if exist "%PROGRAMFILES(X86)%\Bureau\Bureau.exe"  set EXE=%PROGRAMFILES(X86)%\Bureau\Bureau.exe
if not defined EXE if exist "app\src-tauri\target\release\bureau.exe" set EXE=%~dp0app\src-tauri\target\release\bureau.exe

if not defined EXE (
  echo.
  echo  Bureau n'est pas encore installe sur cette machine.
  echo.
  echo  Lance  installeur.bat  une fois. Ensuite ce fichier ouvrira
  echo  l'application directement.
  echo.
  pause
  exit /b 1
)

REM  Une photo de ce que Bureau voit, silencieusement, a chaque lancement.
REM  Si la piece est vide, la reponse est deja dans diagnostic.txt.
if exist "%~dp0bureau-scan.exe" (
  "%~dp0bureau-scan.exe" > "%~dp0diagnostic.txt" 2>&1
)

start "" "%EXE%"
exit /b 0
