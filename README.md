# Correções do traçado e criação visual do metrô

Este pacote corrige o comportamento do metrô na aplicação `city-grid-game`.

## O que corrige

1. O trem deixa de se mover em linha reta entre as estações e passa a seguir os tiles do trilho físico.
2. As linhas do metrô também passam a ser desenhadas sobre o caminho real do trilho.
3. Ao selecionar **Trilho** ou **Criar linha**, a visualização muda automaticamente para **Subsolo**.
4. A criação de trilhos e linhas passa a funcionar por arraste visual:
   - clique em uma estação;
   - arraste passando por outras estações;
   - o preview tracejado aparece no caminho;
   - ao soltar, o trilho ou linha é confirmado.
5. Adiciona preview tracejado para trilhos/linhas em criação.

## Como aplicar

Extraia o ZIP na raiz do projeto e rode:

```powershell
cd C:\Projetos\city-grid-game
node apply-metro-track-line-fixes.cjs
npm run build
npm run dev
```

## Backups

O script cria backup dos arquivos alterados com o sufixo:

```txt
.bak-metro-track-line-fixes
```

## Arquivos alterados pelo script

- `src/store/gameStore.ts`
- `src/game/engine/simulation.ts`
- `src/game/rendering/renderMetro.ts`
- `src/game/rendering/inputController.ts`
- `src/game/rendering/renderUiOverlays.ts`

## Observação

Este pacote é incremental. Ele assume que o pacote anterior do metrô já foi aplicado, incluindo os tipos `MetroStation`, `MetroTrack`, `MetroLine`, `MetroTrain` e a ferramenta `metroStation`, `metroTrack`, `metroLine`.
