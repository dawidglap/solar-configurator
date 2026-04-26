'use client';

export function normalizePlannerStep(value?: string | null) {
  const v = String(value || '').toLowerCase();

  if (
    ['building', 'gebaeude', 'gebäude', 'gebaeudeplanung', 'gebäudeplanung'].includes(
      v
    )
  ) {
    return 'building' as const;
  }

  if (['modules', 'module', 'modulplanung', 'moduleplanung'].includes(v)) {
    return 'modules' as const;
  }

  if (['parts', 'stueckliste', 'stückliste', 'stuckliste'].includes(v)) {
    return 'parts' as const;
  }

  if (['report', 'bericht'].includes(v)) {
    return 'report' as const;
  }

  if (['offer', 'angebot'].includes(v)) {
    return 'offer' as const;
  }

  if (['profile', 'profil', 'ist'].includes(v)) {
    return 'building' as const;
  }

  return null;
}
