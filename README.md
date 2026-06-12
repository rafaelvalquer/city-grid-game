# Cidade em Fluxo

Sandbox de mobilidade urbana em grid feito com React + TypeScript + PixiJS.

## O que já vem implementado

- Cidade em grid.
- Casas, comércios e escritórios gerados aleatoriamente.
- Construção de ruas e avenidas pelo jogador.
- Prédios conectados/desconectados.
- Carros com origem/destino.
- Pathfinding A* próprio com custo dinâmico por rua, avenida e congestionamento.
- Congestionamento por capacidade da via.
- Sistema de dinheiro.
- Satisfação da cidade.
- População crescente.
- Ciclo de dia com horário de pico.
- Heatmap de trânsito.
- Pausar/acelerar simulação.
- Clique para inspecionar carro, rua, prédio ou tile.

## Como executar

```bash
npm install
npm run dev
```

Depois acesse a URL exibida no terminal, normalmente:

```bash
http://localhost:5173
```

## Comandos no jogo

- Selecione Rua ou Avenida e clique/arraste no mapa para construir.
- Selecione Remover para apagar ruas.
- Selecione Inspecionar e clique em prédios, ruas ou carros.
- Use o scroll do mouse para zoom.
- Use Alt + arrastar ou botão do meio para mover a câmera.
- Use os botões 1x, 2x e 4x para controlar a velocidade.

## Próximas evoluções recomendadas

- Pedestres e calçadas.
- Semáforos.
- Mão única.
- Rotatórias.
- Ônibus e pontos de ônibus.
- Salvamento/carregamento do mapa.
- Missões e eventos urbanos.
- Melhorias visuais com sprites.


## Instalação no Windows / PowerShell

Este pacote foi preparado sem `package-lock.json`, para o `npm install` gerar um novo arquivo usando o registry público.

```powershell
npm config set registry https://registry.npmjs.org/
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run dev
```

Se ainda aparecer algum endereço `packages.applied-caas-gateway1.internal.api.openai.org`, apague novamente o `package-lock.json` e rode os comandos acima.
