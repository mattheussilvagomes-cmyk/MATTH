#!/bin/bash
# Dois cliques neste arquivo (Mac) ou execute ./iniciar.command (Linux) para ligar o sistema.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js não foi encontrado. Instale a versão LTS em https://nodejs.org e abra este arquivo de novo."
  read -r -p "Pressione Enter para fechar."
  exit 1
fi
if [ ! -f data/escola.db ]; then
  echo "Criando os dados de demonstração..."
  npm run seed
fi
echo
echo "Ligando o sistema... O navegador vai abrir em alguns segundos."
echo "Para desligar, feche esta janela ou pressione Ctrl+C."
echo
( sleep 3; open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null ) &
npm start
