# Expansão urbana V1 — Bairro Leste

Este pacote adiciona a primeira versão de expansão urbana para o jogo Cidade em Fluxo.

## Como aplicar

```powershell
cd C:\Projetos\city-grid-game
node apply-district-expansion-v1.cjs
npm run build
npm run dev
```

## O que entra nesta versão

- Liberação de expansão no nível 3.
- Satisfação mínima reduzida para 55%.
- População mínima de 250.
- Custo de $ 20.000.
- Compra apenas do Bairro Leste.
- Grid aumenta para a direita, dobrando a largura inicial.
- Novos tiles entram como `empty`.
- Capacidade máxima de carros dobra com o segundo bairro.
- Capacidade máxima de ônibus dobra com o segundo bairro.
- Card visual de expansão no painel de detalhes.
- Backups automáticos com sufixo `.bak-district-expansion-v1`.

## Observação

A V1 não força viagens interbairros. O novo bairro começa vazio e passa a receber construções quando houver vias próximas na área leste.
