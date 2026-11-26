import jpeg from 'jpeg-js';

const encoder = jpeg.default || jpeg;

export function makeJpeg(seed = 1) {
  const width = 160;
  const height = 160;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = (seed * 17 + i) % 255;
    data[i * 4 + 1] = (seed * 29) % 200;
    data[i * 4 + 2] = 90;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(encoder.encode({ data, width, height }, 80).data);
}
