import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useGameStore } from '../store/gameStore';
import type { Tool } from '../types/game.types';
import { groupForTool, toolGroups, toolLabelWithCost, type ToolGroup, type ToolItem } from './toolData';

const TOOL_ROW_Y = -124;
const TOOL_ROW_GAP: Record<number, number> = {
  1: 0,
  2: 96,
  3: 112,
};

export function CanvasToolDock() {
  const [activeGroupId, setActiveGroupId] = useState<ToolGroup['id'] | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedTool = useGameStore((s) => s.selectedTool);
  const setTool = useGameStore((s) => s.setTool);
  const money = useGameStore((s) => s.stats.money);
  const selectedGroup = groupForTool(selectedTool);

  useEffect(() => {
    if (!activeGroupId) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveGroupId(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveGroupId(null);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [activeGroupId]);

  const selectTool = (tool: ToolItem) => {
    setTool(tool.id);
    setActiveGroupId(null);
  };

  return (
    <div className="canvas-tool-dock" ref={rootRef} aria-label="Ferramentas do canvas">
      <div className="canvas-tool-bubbles" role="group" aria-label="Categorias de ferramentas">
        {toolGroups.map((group) => {
          const Icon = group.Icon;
          const isActive = selectedGroup.id === group.id;
          const isOpen = activeGroupId === group.id;

          return (
            <div className="canvas-tool-group" key={group.id}>
              <AnimatePresence>
                {isOpen && (
                  <div className="canvas-tool-radial" aria-label={`Ferramentas de ${group.label}`}>
                    {group.tools.map((tool, index) => (
                      <RadialTool
                        key={tool.id}
                        index={index}
                        total={group.tools.length}
                        tool={tool}
                        selectedTool={selectedTool}
                        money={money}
                        onSelect={selectTool}
                      />
                    ))}
                  </div>
                )}
              </AnimatePresence>

              <motion.button
                className={`canvas-tool-bubble ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}`}
                type="button"
                aria-label={`Abrir ${group.label}`}
                aria-expanded={isOpen}
                onClick={() => setActiveGroupId((current) => current === group.id ? null : group.id)}
                whileHover={{ y: -2, scale: 1.05 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 460, damping: 24 }}
              >
                <span className="canvas-tool-halo" aria-hidden="true" />
                <Icon size={20} />
                <span>{group.label}</span>
              </motion.button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RadialTool({
  index,
  total,
  tool,
  selectedTool,
  money,
  onSelect,
}: {
  index: number;
  total: number;
  tool: ToolItem;
  selectedTool: Tool;
  money: number;
  onSelect: (tool: ToolItem) => void;
}) {
  const Icon = tool.Icon;
  const label = toolLabelWithCost(tool);
  const disabled = tool.cost !== undefined && tool.id !== 'remove' && money < tool.cost;
  const { x, y } = radialPosition(index, total);
  const style = {
    left: `${x - 25}px`,
    top: `${y - 25}px`,
  } as CSSProperties;

  return (
    <motion.button
      className={`canvas-tool-radial-item ${selectedTool === tool.id ? 'active' : ''}`}
      type="button"
      disabled={disabled}
      aria-label={`Selecionar ${label}`}
      title={disabled ? 'Dinheiro insuficiente' : label}
      style={style}
      initial={{ x: -x, y: -y, opacity: 0, scale: 0.42 }}
      animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      exit={{ x: -x, y: -y, opacity: 0, scale: 0.42 }}
      transition={{
        type: 'spring',
        stiffness: 520,
        damping: 27,
        mass: 0.74,
        delay: index * 0.035,
      }}
      whileHover={disabled ? undefined : { scale: 1.14 }}
      whileTap={disabled ? undefined : { scale: 0.93 }}
      onClick={() => {
        if (!disabled) onSelect(tool);
      }}
    >
      <span className="canvas-tool-halo" aria-hidden="true" />
      <Icon size={20} />
      <span className="canvas-tool-radial-label">{label}</span>
    </motion.button>
  );
}

function radialPosition(index: number, total: number): { x: number; y: number } {
  const gap = TOOL_ROW_GAP[total] ?? TOOL_ROW_GAP[3];
  return {
    x: (index - (total - 1) / 2) * gap,
    y: TOOL_ROW_Y,
  };
}
