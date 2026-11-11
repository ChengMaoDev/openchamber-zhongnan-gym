type Position = Readonly<{ x: number; y: number }>;

function location(point: Position): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

export function curvePath(points: readonly Position[], smooth = false): string {
  const first = points[0];
  if (!first) return "";
  let path = `M${location(first)}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) throw new Error("曲线点缺失");
    if (smooth) {
      const middle = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
      path += ` Q${location(previous)} ${location(middle)}`;
    } else path += ` L${location(point)}`;
  }
  const last = points.at(-1);
  if (smooth && last) path += ` Q${location(last)} ${location(last)}`;
  return path;
}
