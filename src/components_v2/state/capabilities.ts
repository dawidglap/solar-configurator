// src/components_v2/state/capabilities.ts
import type { PlannerStep, Tool } from '@/types/planner';

/** Matrice delle capacità: quali tool sono permessi in ogni step */
export const ALLOWED_TOOLS: Record<PlannerStep, Readonly<Tool[]>> = {
    building: ['select', 'draw-roof', 'draw-rect', 'draw-reserved'],
    modules: ['select', 'fill-area'],
    strings: ['select'],
    parts: ['select'],
} as const;

/** Tool di default per ogni step (quando entri nello step o devi resettare) */
export const DEFAULT_TOOL: Record<PlannerStep, Tool> = {
    building: 'select',
    modules: 'select',   // volendo, in futuro potrai mettere 'fill-area'
    strings: 'select',
    parts: 'select',
} as const;

/** Ritorna true se il tool è ammesso nello step corrente */
export function isToolAllowed(step: PlannerStep, tool: Tool): boolean {
    return ALLOWED_TOOLS[step].includes(tool);
}

/** Tool di default per lo step dato */
export function defaultToolFor(step: PlannerStep): Tool {
    return DEFAULT_TOOL[step];
}
