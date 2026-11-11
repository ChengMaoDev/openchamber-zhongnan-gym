export function at(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`矩阵下标越界：${index}`);
  return value;
}

export function solve(matrix: Float64Array, targets: Float64Array): Float64Array {
  const size = targets.length;
  const lower = new Float64Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col <= row; col++) {
      let sum = at(matrix, row * size + col);
      for (let inner = 0; inner < col; inner++) {
        sum -= at(lower, row * size + inner) * at(lower, col * size + inner);
      }
      if (row === col) {
        if (sum <= 0) throw new Error("回归矩阵不是正定矩阵");
        lower[row * size + col] = Math.sqrt(sum);
      } else {
        lower[row * size + col] = sum / at(lower, col * size + col);
      }
    }
  }
  const intermediate = new Float64Array(size);
  for (let row = 0; row < size; row++) {
    let value = at(targets, row);
    for (let col = 0; col < row; col++)
      value -= at(lower, row * size + col) * at(intermediate, col);
    intermediate[row] = value / at(lower, row * size + row);
  }
  const coefficients = new Float64Array(size);
  for (let row = size - 1; row >= 0; row--) {
    let value = at(intermediate, row);
    for (let col = row + 1; col < size; col++)
      value -= at(lower, col * size + row) * at(coefficients, col);
    coefficients[row] = value / at(lower, row * size + row);
  }
  return coefficients;
}
