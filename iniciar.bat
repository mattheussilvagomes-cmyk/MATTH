@echo off
title Escola de Musica - servidor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo O Node.js nao foi encontrado neste computador.
  echo Instale a versao LTS em https://nodejs.org e depois abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
if not exist "data\escola.db" (
  echo Criando os dados de demonstracao...
  call npm run seed
)
echo.
echo Ligando o sistema... O navegador vai abrir em alguns segundos.
echo Para desligar, feche esta janela.
echo.
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:3000"
call npm start
pause
