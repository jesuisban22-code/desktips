@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Bureau - installation

echo.
echo  ==========================================
echo    BUREAU
echo    Regarder les agents travailler, en 3D.
echo  ==========================================
echo.
echo  Ce script construit l'application puis l'installe.
echo  Premier passage : 5 a 15 minutes. Tu peux aller faire autre chose.
echo.

if not exist "app\package.json" (
  echo  [X] Le dossier app\ est introuvable.
  echo      Extrais TOUT le zip au meme endroit, puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

REM ============================================================== prerequis
set MISSING=0

where node >nul 2>&1
if errorlevel 1 (
  echo  [X] Node.js manquant        ^-^> https://nodejs.org  ^(version LTS^)
  set MISSING=1
) else (
  for /f "tokens=*" %%v in ('node --version') do echo  [ok] Node %%v
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo  [X] Rust manquant           ^-^> https://rustup.rs
  set MISSING=1
) else (
  for /f "tokens=*" %%v in ('rustc --version') do echo  [ok] %%v
)

where link.exe >nul 2>&1
if errorlevel 1 (
  echo  [!] Outils C++ de Microsoft absents du PATH.
  echo      Si l'etape 4 echoue, ouvre "Visual Studio Installer", coche
  echo      "Desktop development with C++", puis relance ce fichier depuis
  echo      un "Developer Command Prompt for VS".
) else (
  echo  [ok] Outils C++
)

if "%MISSING%"=="1" (
  echo.
  echo  Installe ce qui manque, REOUVRE une fenetre, puis relance.
  echo.
  pause
  exit /b 1
)

pushd app

REM =================================================================== 1 npm
echo.
echo  [1/5] Dependances...
call npm install
if errorlevel 1 goto :fail_npm
call npm install-scripts approve esbuild >nul 2>&1
if not errorlevel 1 call npm rebuild esbuild >nul 2>&1

REM ================================================================= 2 front
echo.
echo  [2/5] Interface...
call npm run build
if errorlevel 1 goto :fail_front
if not exist "dist\index.html" goto :fail_front

REM  La marche est verifiee par la geometrie, pas par une capture d'ecran :
REM  les pieds restent sur le sol, un pied pose ne glisse pas, et la jambe
REM  libre passe au-dessus du sol. Les trois etaient faux et invisibles.
echo.
echo        Verification de la marche...
call node scripts\gait.mjs
if errorlevel 1 (
  echo.
  echo  [!] La marche ne passe pas ses controles. L'application fonctionnera
  echo      quand meme ; envoie-moi les lignes ci-dessus.
  echo.
)

REM ================================================================= 3 tests
echo.
echo  [3/5] Tests du moteur, sur TES fichiers.
echo        Si un assistant a change de format, ca se voit ici plutot que
echo        dans une piece vide.
pushd src-tauri
call cargo test -p bureau-core
if errorlevel 1 (
  popd
  call :warn_tests
  if errorlevel 1 exit /b 1
  pushd src-tauri
)
call cargo build --release -p bureau-core --bins

REM  La coquille Tauri ne peut pas etre compilee sans moteur de rendu web, donc
REM  je ne peux pas la verifier de mon cote : elle a casse ton build deux fois,
REM  a chaque fois quinze minutes apres le debut. Elle est maintenant compilee
REM  contre des doublures qui copient les signatures de Tauri. Ca echoue en dix
REM  secondes au lieu de quinze minutes.
echo.
echo        Verification de la coquille Tauri...
call cargo check -p bureau-stub-shell
if errorlevel 1 ( popd & goto :fail_stub )
popd

REM ================================================================= 4 tauri
echo.
echo  [4/5] Application. C'est l'etape longue.
echo.
call npm run tauri build
if errorlevel 1 goto :fail_tauri

popd

REM =============================================================== 5 dossiers
echo.
echo  [5/5] Dossiers...

set DROP=%USERPROFILE%\.bureau\sessions
if not exist "%DROP%" mkdir "%DROP%" 2>nul
echo       depot cloud : %DROP%

if exist "%~dp0app\cloud\*.jsonl" copy /y "%~dp0app\cloud\*.jsonl" "%DROP%" >nul 2>&1

> "%USERPROFILE%\.bureau\watch.txt" echo # Dossiers surveilles en plus. Un chemin absolu par ligne.
>> "%USERPROFILE%\.bureau\watch.txt" echo %~dp0app\cloud

if exist "app\src-tauri\target\release\bureau-scan.exe" (
  copy /y "app\src-tauri\target\release\bureau-scan.exe" "%~dp0bureau-scan.exe" >nul
  "%~dp0bureau-scan.exe" > "%~dp0diagnostic.txt" 2>&1
)
if exist "app\src-tauri\target\release\bureau-hook.exe" (
  copy /y "app\src-tauri\target\release\bureau-hook.exe" "%~dp0bureau-hook.exe" >nul
)

set SETUP=
for /r "app\src-tauri\target\release\bundle\nsis" %%f in (*-setup.exe) do set SETUP=%%f

echo.
echo  ==========================================
echo    Construit.
echo  ==========================================
echo.

if not defined SETUP (
  echo  L'installeur n'a pas ete produit. L'application existe quand meme :
  echo    app\src-tauri\target\release\bureau.exe
  echo  Utilise lancer.bat .
  echo.
  pause
  exit /b 0
)

REM  Une instance en cours d'execution empeche l'installeur de remplacer le
REM  binaire, et surtout : elle continue de tourner apres, avec l'ancien code.
taskkill /IM bureau.exe /F >nul 2>&1
taskkill /IM Bureau.exe /F >nul 2>&1

echo  Je lance l'installeur. Accepte, puis ferme cette fenetre.
echo.
start /wait "" "%SETUP%"

REM ------------------------------------------------- declencheur Claude Code
if not exist "%~dp0bureau-hook.exe" goto :no_hook

echo.
echo  ==========================================
echo    Une derniere chose, facultative
echo  ==========================================
echo.
echo  Bureau lit les conversations sur le disque. Une seule chose lui
echo  echappe : le moment ou Claude Code t'ATTEND - une demande
echo  d'autorisation, une question. Rien n'est ecrit tant que tu n'as
echo  pas repondu.
echo.
echo  Un declencheur comble ce trou : Claude Code previent Bureau
echo  lui-meme, et le personnage vient lever la main.
echo.
echo  Concretement, j'ajoute deux entrees dans :
echo    %USERPROFILE%\.claude\settings.json
echo  (PermissionRequest et Notification, lancees en arriere-plan :
echo  Claude Code ne l'attend jamais). Une ancienne inscription de Bureau,
echo  s'il y en a une, est retiree au passage. Une copie du fichier est
echo  gardee a cote, et tu peux tout retirer avec  retirer-declencheur.bat .
echo.

choice /c ON /n /m "  Enregistrer le declencheur ? [O/N] "
if errorlevel 2 goto :no_hook

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\hook\installer-hook.ps1" -Exe "%~dp0bureau-hook.exe"

REM  De quoi revenir en arriere sans moi.
> "%~dp0retirer-declencheur.bat" echo @echo off
>> "%~dp0retirer-declencheur.bat" echo powershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0app\hook\installer-hook.ps1" -Remove
>> "%~dp0retirer-declencheur.bat" echo pause

:no_hook

echo.
echo  ==========================================
echo    Fini.
echo  ==========================================
echo.
echo   Ouvre Bureau avec  lancer.bat  ^(ou le menu Demarrer^).
echo.
echo   Si la piece reste vide, ouvre  diagnostic.txt  : il dit quels
echo   dossiers ont ete trouves et combien de conversations dans chacun.
echo.
pause
exit /b 0

REM ================================================================= echecs
:fail_npm
popd
echo.
echo  ECHEC etape 1 : telechargement des dependances.
echo  Verifie ta connexion internet, puis relance.
echo.
pause
exit /b 1

:fail_front
popd
echo.
echo  ECHEC etape 2 : construction de l'interface.
echo.
echo  Le plus souvent c'est esbuild qui n'est pas installe pour Windows.
echo  Dans app\ , essaie :
echo      npm install-scripts approve esbuild
echo      npm rebuild esbuild
echo  ou, plus radical :
echo      rmdir /s /q node_modules ^& del package-lock.json ^& npm install
echo.
pause
exit /b 1

:warn_tests
echo.
echo  ==========================================
echo    Un test du moteur a echoue
echo  ==========================================
echo.
echo  Le nom du test, au-dessus, dit quoi :
echo.
echo    ..._transcript_... ou ..._hook_...   la LECTURE d'une conversation
echo    ..._discovery_... ou ..._folder_...  le REPERAGE des fichiers
echo    ..._watched_... ou ..._appended_...  le SUIVI des nouveautes
echo.
echo  Si c'est le reperage, l'application marchera quand meme : tu pourras
echo  designer le dossier toi-meme avec le bouton "Connecter", ou installer
echo  le declencheur propose a la fin.
echo.
echo  Si c'est la lecture, la piece restera probablement vide.
echo.
choice /c ON /n /m "  Continuer quand meme ? [O/N] "
if errorlevel 2 (
  echo.
  echo  Arrete. Envoie-moi le nom du test et je le corrige.
  echo.
  pause
  exit /b 1
)
echo.
echo  On continue.
exit /b 0

:fail_stub
echo.
echo  ECHEC : la coquille Tauri ne compile pas.
echo.
echo  C'est une erreur de MA part, pas de ta machine, et elle est visible
echo  au-dessus en entier. Envoie-la moi telle quelle : je n'ai aucun moyen
echo  de compiler cette partie de mon cote, ces doublures sont ce qui s'en
echo  approche le plus.
echo.
pause
exit /b 1

:fail_tauri
popd
echo.
echo  ECHEC etape 4 : construction de l'application.
echo.
echo    - Outils C++ absents ? "Visual Studio Installer", coche
echo      "Desktop development with C++" ^(environ 2 Go^).
echo    - Editeur de liens hors du PATH ? relance depuis un
echo      "Developer Command Prompt for VS" ^(menu Demarrer^).
echo    - WebView2 absent ^(rare sur Windows 11^) :
echo      https://developer.microsoft.com/microsoft-edge/webview2/
echo.
pause
exit /b 1
