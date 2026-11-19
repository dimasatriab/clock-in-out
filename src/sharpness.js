import jpeg from 'jpeg-js';

const decoder = jpeg.default || jpeg;

export function measureSharpness(buffer) {
  try {
    const decoded = decoder.decode(buffer, { useTArray: true, formatAsRGBA: true });
    return varianceFromRgba(decoded.data, decoded.width, decoded.height);
  } catch {
    return { variance: 0, side: 0 };
  }
}

export function varianceFromRgba(data, width, height) {
  const side = Math.min(width || 0, height || 0);
  if (width < 3 || height < 3) return { variance: 0, side };
  const step = Math.max(1, Math.floor(side / 80));
  const gray = (x, y) => {
    const index = (y * width + x) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const center = gray(x, y);
      const lap = gray(x, y - step) + gray(x, y + step) + gray(x - step, y) + gray(x + step, y) - 4 * center;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  if (count < 8) return { variance: 0, side };
  const mean = sum / count;
  return { variance: sumSq / count - mean * mean, side };
}

export function isTooFlat(measurement, minimum, minSide = 200) {
  if (!measurement || measurement.side < minSide) return false;
  return measurement.variance <= minimum;
}
