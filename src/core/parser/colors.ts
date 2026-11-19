export const YARN_COLORS: Record<string, string> = {
  // Neutrals & Metals
  white: '#F8FAFC',
  cream: '#FEF3C7',
  ivory: '#FFFBEB',
  oatmeal: '#E7E5E4',
  beige: '#D6D3D1',
  silver: '#CBD5E1',
  grey: '#94A3B8',
  gray: '#94A3B8',
  slate: '#64748B',
  charcoal: '#334155',
  black: '#1E293B',

  // Browns & Capybara Tones
  tan: '#D4A373',
  camel: '#C68B59',
  fawn: '#C89F7B',
  caramel: '#B45309',
  brown: '#78350F',
  chestnut: '#6C3428',
  chocolate: '#5C2C16',
  coffee: '#4A2511',
  espresso: '#3B1D0E',
  wood: '#854D0E',

  // Blues (Hylian Shield, Sky, Ocean)
  sky: '#38BDF8',
  cyan: '#06B6D4',
  aqua: '#22D3EE',
  teal: '#14B8A6',
  blue: '#2563EB',
  royal: '#1D4ED8',
  cobalt: '#1E40AF',
  navy: '#1E3A8A',
  indigo: '#4F46E5',

  // Greens (Tunic, Leaves, Stems)
  mint: '#34D399',
  emerald: '#10B981',
  green: '#22C55E',
  lime: '#84CC16',
  leaf: '#16A34A',
  forest: '#15803D',
  sage: '#86EFAC',
  olive: '#65A30D',

  // Reds, Pinks & Flowers
  coral: '#FB7185',
  salmon: '#FDA4AF',
  pink: '#F472B6',
  blush: '#F9A8D4',
  rose: '#E11D48',
  red: '#EF4444',
  crimson: '#DC2626',
  ruby: '#BE123C',
  burgundy: '#881337',

  // Yellows & Oranges
  lemon: '#FDE047',
  yellow: '#FACC15',
  gold: '#EAB308',
  mustard: '#CA8A04',
  amber: '#F59E0B',
  peach: '#FDBA74',
  orange: '#F97316',
  rust: '#C2410C',

  // Purples
  lavender: '#C4B5FD',
  lilac: '#D8B4FE',
  violet: '#8B5CF6',
  purple: '#9333EA',
  plum: '#7E22CE',
  magenta: '#DB2777',
};

export const DEFAULT_PIECE_PALETTE = [
  '#38BDF8', // Sky Blue
  '#34D399', // Emerald Mint
  '#F472B6', // Rose Pink
  '#FBBF24', // Warm Gold
  '#A78BFA', // Soft Violet
  '#FB7185', // Coral
];

export function resolveYarnColor(raw: string, fallback = '#38BDF8'): string {
  const cleaned = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(cleaned)) {
    return cleaned.toUpperCase();
  }
  if (/^#[0-9a-f]{3}$/i.test(cleaned)) {
    const r = cleaned[1];
    const g = cleaned[2];
    const b = cleaned[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  // Check exact match first, then substring words (e.g. "dark brown" -> brown, "royal blue" -> royal)
  if (YARN_COLORS[cleaned]) {
    return YARN_COLORS[cleaned];
  }
  if (cleaned === 'dark brown') return '#5C2C16';
  if (cleaned === 'light brown') return '#B07D52';
  if (cleaned === 'golden brown') return '#B45309';
  if (cleaned === 'skin tone' || cleaned === 'skin' || cleaned === 'flesh') return '#FDBA74';
  if (cleaned === 'dark green') return '#15803D';
  if (cleaned === 'light blue') return '#7DD3FC';
  if (cleaned === 'dark grey' || cleaned === 'dark gray') return '#475569';
  if (cleaned === 'light grey' || cleaned === 'light gray') return '#CBD5E1';

  const words = cleaned.split(/[\s_-]+/);
  for (const w of words) {
    if (YARN_COLORS[w]) {
      return YARN_COLORS[w];
    }
  }
  return fallback;
}
