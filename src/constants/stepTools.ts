// src/constants/stepTools.ts
import type { PlannerStep, Tool } from '@/types/planner';

/**
 * Tools ammessi in ciascuno step
 */
export const ALLOWED_TOOLS: Record<PlannerStep, Tool[]> = {
    profile: ['select'],
    ist: ['select'],

    building: ['select', 'draw-roof', 'draw-rect', 'draw-reserved', 'draw-snow-guard'],
    modules: ['select', 'fill-area'], // + 'select-roof' se lo aggiungeremo più avanti
    strings: ['select'], // in futuro potremo aggiungere tool per i collegamenti
    parts: ['select'],
    report: ['select'],
    offer: ['select'],
};

/**
 * Tool di default quando entri in uno step
 */
export const DEFAULT_TOOL: Record<PlannerStep, Tool> = {
    profile: 'select',
    ist: 'select',

    building: 'select',
    modules: 'select', // volendo potremmo anche usare 'fill-area'
    strings: 'select',
    parts: 'select',
    report: 'select',
    offer: 'select',
};
