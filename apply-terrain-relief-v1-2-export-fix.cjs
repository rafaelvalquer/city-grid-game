const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupSuffix = '.bak-terrain-relief-v1-2-export-fix';

function filePath(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(filePath(rel), 'utf8');
}

function write(rel, content) {
  const abs = filePath(rel);
  if (fs.existsSync(abs) && !fs.existsSync(abs + backupSuffix)) {
    fs.copyFileSync(abs, abs + backupSuffix);
  }
  fs.writeFileSync(abs, content, 'utf8');
  console.log('updated', rel);
}

function patch(rel, updater) {
  const abs = filePath(rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`Arquivo não encontrado: ${rel}. Aplique primeiro os pacotes de relevo V1/V1.2.`);
  }
  const original = read(rel);
  const next = updater(original);
  if (next !== original) write(rel, next);
  else console.log('unchanged', rel);
}

function ensureAnimationExportAlias(source) {
  let s = source;

  const hasSingular = /export\s+function\s+drawTerrainFeatureAnimation\s*\(/.test(s);
  const hasPlural = /export\s+function\s+drawTerrainFeatureAnimations\s*\(/.test(s);

  if (!hasSingular && hasPlural) return s;

  if (!hasSingular) {
    throw new Error('renderTerrainFeatures.ts não possui drawTerrainFeatureAnimation(). Reaplique o pacote V1.2 antes desta correção.');
  }

  if (!hasPlural) {
    const alias = `

// Compatibilidade: alguns patches anteriores importaram o nome no plural.
export function drawTerrainFeatureAnimations(graphics: Graphics, grid: Tile[][], ts: number, timeSeconds: number): void {
  drawTerrainFeatureAnimation(graphics, grid, ts, timeSeconds);
}
`;
    s = s.trimEnd() + alias;
  }

  return s;
}

function normalizeRenderWorldImport(source) {
  let s = source;

  // Normaliza o uso para o nome oficial singular. O alias no arquivo de features fica como segurança.
  s = s.replace(/drawTerrainFeatureAnimations/g, 'drawTerrainFeatureAnimation');

  // Garante que a importação contenha os dois nomes necessários, sem duplicar.
  if (s.includes("'./renderTerrainFeatures'")) {
    s = s.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]\.\/renderTerrainFeatures['"];?/,
      (_match, names) => {
        const parts = names.split(',').map((item) => item.trim()).filter(Boolean);
        const unique = [];
        for (const part of parts) {
          if (!unique.includes(part)) unique.push(part);
        }
        if (!unique.includes('drawTerrainFeatureBase')) unique.push('drawTerrainFeatureBase');
        if (!unique.includes('drawTerrainFeatureAnimation')) unique.push('drawTerrainFeatureAnimation');
        return `import { ${unique.join(', ')} } from './renderTerrainFeatures';`;
      },
    );
  } else {
    s = s.replace(
      /import\s+\{\s*renderMetroLayer\s*\}\s+from\s+['"]\.\/renderMetro['"];?/,
      "import { renderMetroLayer } from './renderMetro';\nimport { drawTerrainFeatureBase, drawTerrainFeatureAnimation } from './renderTerrainFeatures';",
    );
  }

  return s;
}

function validate() {
  const features = read('src/game/rendering/renderTerrainFeatures.ts');
  const world = read('src/game/rendering/renderWorld.ts');

  if (!/export\s+function\s+drawTerrainFeatureAnimation\s*\(/.test(features)) {
    throw new Error('Validação falhou: drawTerrainFeatureAnimation não foi encontrado em renderTerrainFeatures.ts.');
  }

  if (!/export\s+function\s+drawTerrainFeatureAnimations\s*\(/.test(features)) {
    throw new Error('Validação falhou: alias drawTerrainFeatureAnimations não foi criado.');
  }

  if (/drawTerrainFeatureAnimations/.test(world)) {
    throw new Error('Validação falhou: renderWorld.ts ainda usa drawTerrainFeatureAnimations no plural.');
  }

  if (!/drawTerrainFeatureAnimation/.test(world)) {
    throw new Error('Validação falhou: renderWorld.ts não usa drawTerrainFeatureAnimation.');
  }
}

function main() {
  patch('src/game/rendering/renderTerrainFeatures.ts', ensureAnimationExportAlias);
  patch('src/game/rendering/renderWorld.ts', normalizeRenderWorldImport);
  validate();
  console.log('\nCorreção aplicada com sucesso. Execute: npm run build');
}

main();
