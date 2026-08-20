/** 渲染进程(歌词窗 / 设置窗)共用的颜色工具。 */

/** #rrggbb → [r, g, b](允许省略 #) */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

/** rgba() 字符串组装(alpha 固定两位小数,与旧实现输出格式一致) */
export function rgba(r: number, g: number, b: number, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

/** hex + 不透明度百分比 → rgba() 字符串 */
export function hexToRgba(hex: string, opacityPercent: number): string {
  if (!hex) return "rgba(255, 255, 255, 1)";
  const [r, g, b] = hexToRgb(hex);
  return rgba(r, g, b, opacityPercent / 100);
}

/** rgb 分量 → #rrggbb */
export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
