# Cidade em Fluxo — Metrô Surface V2

Este pacote aplica a evolução do sistema de metrô:

- estação de metrô como construção de superfície, ocupando 1 tile vazio;
- animação da estação na superfície e no subsolo;
- métricas ampliadas por estação e por linha;
- métricas do metrô na aba Transporte do Analytics;
- painel de gerenciamento de linhas no modo Subsolo;
- exclusão de linhas sem remover estações/trilhos;
- manutenção do fluxo atual: se não houver metrô válido, o jogo continua tentando ônibus e depois carro.

## Como aplicar

Extraia o ZIP na raiz do projeto e execute:

```powershell
node apply-metro-surface-v2.cjs
npm run build
npm run dev
```

O script detecta se o Metrô V1 já está aplicado. Se não estiver, aplica o `apply-metro-system.cjs` incluído antes de instalar a V2.

## Backups

Arquivos alterados recebem backup com sufixo:

```txt
.bak-metro-surface-v2
```

Caso o V1 precise ser aplicado, ele também pode criar backups `.bak-metro-v1`.

## Arquivos novos ou atualizados

```txt
src/types/metro.types.ts
src/game/rendering/renderMetro.ts
src/components/MetroManagementPanel.tsx
```

## Arquivos alterados por script

```txt
src/types/city.types.ts
src/store/gameStore.ts
src/game/engine/simulation.ts
src/game/rendering/inputController.ts
src/game/rendering/PixiGame.tsx
src/components/DetailsPanel.tsx
src/components/AnalyticsPanel.tsx
src/components/HudBar.tsx
src/styles.css
```

## Observações

- A estação agora só pode ser construída em tile `empty`.
- A estação passa a gravar o tile como `type: 'metroStation'` e `metroStationId`.
- Ruas/avenidas não podem ser construídas por cima da estação.
- Excluir uma linha remove apenas linha e trens, mantendo estações e trilhos.
- Remover uma estação remove a estação, seus trilhos conectados, linhas dependentes e trens dessas linhas.
