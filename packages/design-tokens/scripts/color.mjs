const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB =
  /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

export function parseColor(input) {
  if (typeof input !== 'string') throw new Error(`Couleur invalide : ${String(input)}`);
  const value = input.trim();
  const hex = value.match(HEX);
  if (hex) {
    let body = hex[1];
    if (body.length === 3)
      body = body
        .split('')
        .map((char) => char + char)
        .join('');
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb = value.match(RGB);
  if (rgb) {
    const alpha =
      rgb[4] === undefined
        ? 1
        : rgb[4].endsWith('%')
          ? Number(rgb[4].slice(0, -1)) / 100
          : Number(rgb[4]);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
  }
  throw new Error(`Couleur non prise en charge : ${value}`);
}

export function composite(color, base) {
  const fg = typeof color === 'string' ? parseColor(color) : color;
  const bg = typeof base === 'string' ? parseColor(base) : base;
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(foreground, background) {
  const base = typeof background === 'string' ? parseColor(background) : background;
  const fg = composite(foreground, base);
  const l1 = luminance(fg);
  const l2 = luminance(base);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function hex(color) {
  const c = typeof color === 'string' ? parseColor(color) : color;
  const part = (value) => Math.round(value).toString(16).padStart(2, '0');
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}
