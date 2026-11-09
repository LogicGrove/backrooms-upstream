export function softwareRenderer(name: string) {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver|warp/i.test(name);
}
export function renderRatio(width: number, height: number, dpr: number, low: boolean, software: boolean, scale: number) {
  if (software) return Math.min(1, 360 / width, 203 / height) * scale;
  return Math.min(dpr, 1080 / height) * (low ? 0.6 : 1) * scale;
}
