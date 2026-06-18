#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PATCH_NAME = 'performance-workers-v4-scale-fix';
const RENDER_WORLD = path.join(ROOT, 'src', 'game', 'rendering', 'renderWorld.ts');

function fail(message) {
  throw new Error(message);
}

function readFile(file) {
  if (!fs.existsSync(file)) fail(`Arquivo não encontrado: ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function writeFileWithBackup(file, content) {
  const original = fs.readFileSync(file, 'utf8');
  const backup = `${file}.bak-${PATCH_NAME}`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original);
  fs.writeFileSync(file, content);
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let current = '';
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let quote = null;
  let escaped = false;
  for (let i = 0; i < argsText.length; i += 1) {
    const ch = argsText[i];
    if (quote) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depthParen += 1;
    if (ch === ')') depthParen -= 1;
    if (ch === '{') depthBrace += 1;
    if (ch === '}') depthBrace -= 1;
    if (ch === '[') depthBracket += 1;
    if (ch === ']') depthBracket -= 1;
    if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      const trimmed = current.trim();
      if (trimmed) args.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) args.push(trimmed);
  return args;
}

function replaceCallArguments(source, callName, transform) {
  const callIndex = source.indexOf(`${callName}(`);
  if (callIndex < 0) fail(`Chamada ${callName}(...) não encontrada.`);
  const openIndex = source.indexOf('(', callIndex);
  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex < 0) fail(`Não foi possível localizar fechamento da chamada ${callName}(...).`);
  const before = source.slice(0, openIndex + 1);
  const argsText = source.slice(openIndex + 1, closeIndex);
  const after = source.slice(closeIndex);
  const args = splitTopLevelArgs(argsText);
  const nextArgs = transform(args);
  const formatted = `\n  ${nextArgs.join(',\n  ')},\n`;
  return before + formatted + after;
}

function replaceFunctionParameters(source, functionName, transform) {
  const fnIndex = source.indexOf(`function ${functionName}(`);
  if (fnIndex < 0) fail(`Função ${functionName}(...) não encontrada.`);
  const openIndex = source.indexOf('(', fnIndex);
  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex < 0) fail(`Não foi possível localizar fechamento da assinatura ${functionName}(...).`);
  const before = source.slice(0, openIndex + 1);
  const paramsText = source.slice(openIndex + 1, closeIndex);
  const after = source.slice(closeIndex);
  const params = splitTopLevelArgs(paramsText);
  const nextParams = transform(params);
  const formatted = `\n  ${nextParams.join(',\n  ')},\n`;
  return before + formatted + after;
}

function insertAfter(list, anchorPredicate, value, valuePredicate = (item) => item.trim() === value.trim()) {
  if (list.some(valuePredicate)) return list;
  const index = list.findIndex(anchorPredicate);
  if (index < 0) fail(`Âncora não encontrada para inserir ${value}.`);
  return [...list.slice(0, index + 1), value, ...list.slice(index + 1)];
}

function patchRenderWorld(source) {
  let next = source;

  next = replaceCallArguments(next, 'renderDynamicLayer', (args) => {
    // renderWorld(...) already has scale in scope. renderDynamicLayer must receive it.
    return insertAfter(
      args,
      (arg) => arg.trim() === 'viewLayer',
      'scale',
      (arg) => arg.trim() === 'scale'
    );
  });

  next = replaceFunctionParameters(next, 'renderDynamicLayer', (params) => {
    return insertAfter(
      params,
      (param) => /^viewLayer\s*:\s*ViewLayer\b/.test(param.trim()),
      'scale: number',
      (param) => /^scale\s*:\s*number\b/.test(param.trim())
    );
  });

  return next;
}

function validate(source) {
  const fnIndex = source.indexOf('function renderDynamicLayer(');
  if (fnIndex < 0) fail('renderDynamicLayer não encontrado após patch.');
  const openIndex = source.indexOf('(', fnIndex);
  const closeIndex = findMatchingParen(source, openIndex);
  const signature = source.slice(openIndex + 1, closeIndex);
  if (!/scale\s*:\s*number/.test(signature)) {
    fail('renderDynamicLayer ainda usa scale sem receber scale: number.');
  }

  const callIndex = source.indexOf('renderDynamicLayer(');
  if (callIndex < 0) fail('Chamada renderDynamicLayer não encontrada após patch.');
  const callOpen = source.indexOf('(', callIndex);
  const callClose = findMatchingParen(source, callOpen);
  const callArgs = splitTopLevelArgs(source.slice(callOpen + 1, callClose));
  const viewLayerIndex = callArgs.findIndex((arg) => arg.trim() === 'viewLayer');
  const scaleIndex = callArgs.findIndex((arg) => arg.trim() === 'scale');
  if (viewLayerIndex < 0 || scaleIndex < 0 || scaleIndex <= viewLayerIndex) {
    fail('A chamada renderDynamicLayer(...) ainda não passa scale após viewLayer.');
  }
}

function main() {
  const source = readFile(RENDER_WORLD);
  const patched = patchRenderWorld(source);
  validate(patched);
  writeFileWithBackup(RENDER_WORLD, patched);
  console.log('Correção aplicada com sucesso.');
  console.log('- renderWorld.ts agora passa scale para renderDynamicLayer(...)');
  console.log('- renderDynamicLayer(...) agora recebe scale: number');
  console.log(`Backup: ${path.relative(ROOT, RENDER_WORLD)}.bak-${PATCH_NAME}`);
}

try {
  main();
} catch (error) {
  console.error('\nERRO ao aplicar correção:');
  console.error(error.message || error);
  process.exit(1);
}
