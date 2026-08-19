@echo off
REM Ponto de entrada para quem so quer dar duplo-clique.
REM Chama o instalador em PowerShell, contornando a politica de execucao
REM sem alterar nenhuma configuracao da maquina.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
