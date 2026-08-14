// DSH dynamic Cordis plugin — Client half (value of `code.client` in cordis_define).
// Registers a `sidebar.footer.action` button (rendered above the Settings row)
// that opens a panel with two QR codes pointing at the auth-gated reverse proxy
// (LAN + public). The codes refresh every 30s because the auth secret rotates.
// The QR encoder is fully self-contained (byte mode, EC M, auto-version).
//
// ---- QR code encoder (byte mode, Nayuki-style) ----
function rsMultiply(x, y) {
  if ((x >>> 8) !== 0 || (y >>> 8) !== 0) throw new Error('byte out of range')
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
function rsDivisor(degree) {
  let result = []
  for (let i = 0; i < degree - 1; i++) result.push(0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = rsMultiply(root, 0x02)
  }
  return result
}
function rsRemainder(data, divisor) {
  let result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor) })
  }
  return result
}
const ECC_CODEWORDS_PER_BLOCK = [
  [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1,  1,  1,  1,  1,  1,  2,  2,  2,  2,  4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1,  1,  1,  1,  2,  2,  4,  4,  4,  5,  5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1,  1,  1,  2,  2,  4,  4,  6,  6,  8,  8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1,  1,  1,  2,  4,  4,  4,  5,  6,  8,  8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]
const ECC_FORMAT_BITS = [1, 0, 3, 2]
function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}
function dataCodewords(ver, ecl) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver]
}
function totalBitsByte(numChars, ver) {
  return 4 + (ver <= 9 ? 8 : 16) + 8 * numChars
}
function appendBits(arr, val, len) {
  for (let i = len - 1; i >= 0; i--) arr.push(((val >>> i) & 1) !== 0)
}
function alignPositions(ver) {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}
function getBit(x, i) { return ((x >>> i) & 1) !== 0 }
function buildQrMatrix(text, ecl) {
  const bytes = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F))
    else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F))
  }
  let version = 1
  for (; version <= 40; version++) {
    if (totalBitsByte(bytes.length, version) <= dataCodewords(version, ecl) * 8) break
  }
  if (version > 40) throw new Error('data too long')
  const capacityBits = dataCodewords(version, ecl) * 8
  const usedBits = totalBitsByte(bytes.length, version)
  let bb = []
  appendBits(bb, 0x4, 4)
  appendBits(bb, bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) appendBits(bb, b, 8)
  appendBits(bb, 0, Math.min(4, capacityBits - usedBits))
  appendBits(bb, 0, (8 - bb.length % 8) % 8)
  for (let pad = 0xEC; bb.length < capacityBits; pad ^= 0xEC ^ 0x11) appendBits(bb, pad, 8)
  const data = []
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | (bb[i + j] ? 1 : 0)
    data.push(v)
  }
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const numShortBlocks = numBlocks - rawCodewords % numBlocks
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const div = rsDivisor(blockEccLen)
  const blocks = []
  let k = 0
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const dat = data.slice(k, k + datLen)
    k += datLen
    const ecc = rsRemainder(dat, div)
    if (i < numShortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const codewords = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) codewords.push(block[i])
    })
  }
  const size = version * 4 + 17
  const modules = []
  const isFunction = []
  for (let y = 0; y < size; y++) {
    modules.push(new Array(size).fill(false))
    isFunction.push(new Array(size).fill(false))
  }
  function setFunction(x, y, dark) { modules[y][x] = dark; isFunction[y][x] = true }
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0)
    setFunction(i, 6, i % 2 === 0)
  }
  function drawFinder(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = x + dx, yy = y + dy
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFunction(xx, yy, dist !== 2 && dist !== 4)
      }
    }
  }
  drawFinder(3, 3)
  drawFinder(size - 4, 3)
  drawFinder(3, size - 4)
  const align = alignPositions(version)
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue
      const ax = align[i], ay = align[j]
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFunction(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  const FORMAT_MASK = 0x5412
  function formatBitsValue(mask) {
    const d = (ECC_FORMAT_BITS[ecl] << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    return ((d << 10) | rem) ^ FORMAT_MASK
  }
  function setFormatBits(mask) {
    const bits = formatBitsValue(mask)
    for (let i = 0; i <= 5; i++) setFunction(8, i, getBit(bits, i))
    setFunction(8, 7, getBit(bits, 6))
    setFunction(8, 8, getBit(bits, 7))
    setFunction(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, getBit(bits, i))
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, getBit(bits, i))
    setFunction(8, size - 8, true)
  }
  function setVersionBits() {
    if (version < 7) return
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i)
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(a, b, color)
      setFunction(b, a, color)
    }
  }
  setFormatBits(0)
  setVersionBits()
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7))
          bitIndex++
        }
      }
    }
  }
  const N1 = 3, N2 = 3, N3 = 40, N4 = 10
  function maskCondition(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0
      case 1: return y % 2 === 0
      case 2: return x % 3 === 0
      case 3: return (x + y) % 3 === 0
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
      case 5: return (x * y) % 2 + (x * y) % 3 === 0
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0
      case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0
      default: return false
    }
  }
  function finderPenaltyCount(h) {
    const n = h[1]
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
  }
  function finderPenaltyAdd(h, runLen) {
    if (h[0] === 0) runLen += size
    h.pop()
    h.unshift(runLen)
  }
  function finderPenaltyTerminate(color, runLen, h) {
    if (color) { finderPenaltyAdd(h, runLen); runLen = 0 }
    runLen += size
    finderPenaltyAdd(h, runLen)
    return finderPenaltyCount(h)
  }
  function penalty(mat) {
    let result = 0
    for (let y = 0; y < size; y++) {
      let runColor = false, runLen = 0
      const h = [0,0,0,0,0,0,0]
      for (let x = 0; x < size; x++) {
        if (mat[y][x] === runColor) {
          runLen++
          if (runLen === 5) result += N1
          else if (runLen > 5) result++
        } else {
          finderPenaltyAdd(h, runLen)
          if (!runColor) result += finderPenaltyCount(h) * N3
          runColor = mat[y][x]
          runLen = 1
        }
      }
      result += finderPenaltyTerminate(runColor, runLen, h) * N3
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runLen = 0
      const h = [0,0,0,0,0,0,0]
      for (let y = 0; y < size; y++) {
        if (mat[y][x] === runColor) {
          runLen++
          if (runLen === 5) result += N1
          else if (runLen > 5) result++
        } else {
          finderPenaltyAdd(h, runLen)
          if (!runColor) result += finderPenaltyCount(h) * N3
          runColor = mat[y][x]
          runLen = 1
        }
      }
      result += finderPenaltyTerminate(runColor, runLen, h) * N3
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = mat[y][x]
        if (c === mat[y][x+1] && c === mat[y+1][x] && c === mat[y+1][x+1]) result += N2
      }
    }
    let dark = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mat[y][x]) dark++
    const total = size * size
    const kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
    result += kk * N4
    return result
  }
  function applyMask(mat, mask) {
    const m = mat.map((row) => row.slice())
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunction[y][x] && maskCondition(mask, x, y)) m[y][x] = !m[y][x]
      }
    }
    const bits = formatBitsValue(mask)
    const setF = (x, y, v) => { m[y][x] = v }
    for (let i = 0; i <= 5; i++) setF(8, i, getBit(bits, i))
    setF(8, 7, getBit(bits, 6))
    setF(8, 8, getBit(bits, 7))
    setF(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setF(14 - i, 8, getBit(bits, i))
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, getBit(bits, i))
    setF(8, size - 8, true)
    return m
  }
  let bestMask = 0, bestScore = Infinity, bestMatrix = null
  for (let m = 0; m < 8; m++) {
    const trial = applyMask(modules, m)
    const score = penalty(trial)
    if (score < bestScore) { bestScore = score; bestMask = m; bestMatrix = trial }
  }
  return bestMatrix
}
function matrixToSvg(matrix, scale, margin) {
  const n = matrix.length
  const dim = (n + margin * 2) * scale
  let rects = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) rects += '<rect x="' + ((x + margin) * scale) + '" y="' + ((y + margin) * scale) + '" width="' + scale + '" height="' + scale + '"/>'
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" style="width:100%;height:100%;display:block"><rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/><g fill="#000000">' + rects + '</g></svg>'
}
function qrIcon() {
  const finders = [[0, 0], [9, 0], [0, 9]]
  let d = ''
  for (const p of finders) {
    d += 'M' + p[0] + ' ' + p[1] + 'h7v7h-7z'
    d += 'M' + (p[0] + 1) + ' ' + (p[1] + 1) + 'h5v5h-5z'
    d += 'M' + (p[0] + 2) + ' ' + (p[1] + 2) + 'h3v3h-3z'
  }
  d += 'M10 10h2v2h-2zM13 10h2v2h-2zM10 13h2v2h-2zM13 13h2v2h-2z'
  return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', fillRule: 'evenodd', 'aria-hidden': 'true' }, React.createElement('path', { d: d }))
}
const QR_CSS = '.hHd-Xa_footerActions{flex-direction:column}.dshqr-layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}.dshqr-buttons{align-items:center;width:100%;display:flex}.dshqr-badge{cursor:pointer;width:100%;height:49px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}.dshqr-badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.dshqr-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.dshqr-layer.dshqr-rail{width:36px;height:36px;margin:0}.dshqr-rail .dshqr-badge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}.dshqr-panel{z-index:30;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);width:320px;max-width:calc(100vw - 24px);box-shadow:var(--dsw-shadow-lv2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:128px;left:12px;overflow:hidden;animation:dshqrFadeIn 180ms ease}.dshqr-panel.dshqr-closing{animation:dshqrFadeOut 180ms ease forwards}.dshqr-header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}.dshqr-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}.dshqr-close{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;font-size:18px;line-height:1;padding:0}.dshqr-close:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshqr-body{flex:1;min-height:0;padding:14px;flex-direction:column;align-items:center;gap:14px;display:flex;max-height:calc(100vh - 180px);overflow-y:auto}.dshqr-block{flex-direction:column;align-items:center;gap:8px;display:flex;width:100%}.dshqr-qr{width:170px;height:170px;border-radius:8px;overflow:hidden;background:#fff}.dshqr-kind{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}.dshqr-url{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;word-break:break-all;text-align:center;margin:0}.dshqr-count{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;margin:0;text-align:center}.dshqr-config{border-top:1px solid var(--dsw-alias-border-l2);flex:none;width:100%;align-items:center;gap:8px;padding-top:12px;display:flex}.dshqr-configlabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:1}.dshqr-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:64px;height:28px;color:var(--dsw-alias-label-secondary);font:inherit;border-radius:7px;padding:0 8px}.dshqr-apply{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;padding:0 10px}.dshqr-apply:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshqr-msg{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;margin:0;text-align:center}.dshqr-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:0;text-align:center}.dshqr-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0;text-align:center}@keyframes dshqrFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes dshqrFadeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}'
const SETTINGS_CSS = '.dshqr-settings-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:12px;padding:12px 14px;flex-direction:column;gap:10px;display:flex}.dshqr-settings-head{flex-direction:column;gap:2px;display:flex}.dshqr-settings-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}.dshqr-settings-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dshqr-settings-row{align-items:center;gap:10px;display:flex}.dshqr-settings-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:1}.dshqr-settings-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);width:90px;height:28px;color:var(--dsw-alias-label-secondary);font:inherit;border-radius:7px;padding:0 8px}.dshqr-settings-actions{align-items:center;gap:10px;justify-content:flex-end;display:flex}.dshqr-settings-save{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:7px;padding:0 12px}.dshqr-settings-save:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshqr-settings-msg{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}'
function ConfigCard() {
  const [state, setState] = React.useState({ status: 'loading', port: '', days: '' })
  const [msg, setMsg] = React.useState('')
  React.useEffect(() => {
    host.call('get-config').then((c) => {
      setState({ status: 'ready', port: String(c && c.port), days: String(c && c.sessionDays) })
    }).catch(() => setState({ status: 'error', port: '', days: '' }))
  }, [])
  function save() {
    const port = Number(state.port)
    const days = Number(state.days)
    if (!(port > 0 && port < 65536)) { setMsg('Port must be 1-65535'); return }
    if (!(days > 0 && days <= 3650)) { setMsg('Days must be 1-3650'); return }
    host.call('set-config', { port: port, sessionDays: days }).then((c) => {
      setState({ status: 'ready', port: String(c && c.port), days: String(c && c.sessionDays) })
      setMsg('Saved')
    }).catch(() => setMsg('Save failed'))
  }
  return React.createElement('li', { className: 'dshqr-settings-card' },
    React.createElement('div', { className: 'dshqr-settings-head' },
      React.createElement('span', { className: 'dshqr-settings-title' }, 'QR connect'),
      React.createElement('span', { className: 'dshqr-settings-sub' }, 'LAN reverse proxy for mobile access')
    ),
    React.createElement('div', { className: 'dshqr-settings-row' },
      React.createElement('label', { className: 'dshqr-settings-label' }, 'Proxy port'),
      React.createElement('input', { className: 'dshqr-settings-input', type: 'number', min: 1, max: 65535, value: state.port, onChange: (e) => setState({ ...state, port: e.target.value }) })
    ),
    React.createElement('div', { className: 'dshqr-settings-row' },
      React.createElement('label', { className: 'dshqr-settings-label' }, 'Session length (days)'),
      React.createElement('input', { className: 'dshqr-settings-input', type: 'number', min: 1, max: 3650, value: state.days, onChange: (e) => setState({ ...state, days: e.target.value }) })
    ),
    React.createElement('div', { className: 'dshqr-settings-actions' },
      React.createElement('button', { type: 'button', className: 'dshqr-settings-save', onClick: save }, 'Save'),
      msg ? React.createElement('span', { className: 'dshqr-settings-msg' }, msg) : null
    )
  )
}
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    styles.insert(QR_CSS)
    styles.insert(SETTINGS_CSS)
    slots.inject('settings.plugin.item', () => slots.register(
      { name: 'settings.plugin.item', id: 'qr-connect', order: 100 },
      ConfigCard
    ))
    function QrConnect(props) {
      const wide = props.wide
      const [open, setOpen] = React.useState(false)
      const [closing, setClosing] = React.useState(false)
      const [state, setState] = React.useState({ status: 'idle', localUrl: null, publicUrl: null })
      const [left, setLeft] = React.useState(30)
      const [days, setDays] = React.useState('30')
      const [msg, setMsg] = React.useState('')
      function buildUrls(info) {
        if (!info || !info.secret || !info.port) return { localUrl: null, publicUrl: null }
        const make = (host) => 'http://' + host + ':' + info.port + '/?auth=' + info.secret
        return {
          localUrl: info.ip ? make(info.ip) : null,
          publicUrl: info.publicIp ? make(info.publicIp) : null,
        }
      }
      function refresh() {
        return host.call('proxy-info').then((info) => {
          const urls = buildUrls(info)
          if (urls.localUrl || urls.publicUrl) {
            setState({ status: 'ready', localUrl: urls.localUrl, publicUrl: urls.publicUrl })
          } else {
            setState({ status: 'error', localUrl: null, publicUrl: null })
          }
        }).catch(() => {
          setState({ status: 'error', localUrl: null, publicUrl: null })
        })
      }
      React.useEffect(() => {
        if (!open) return
        setState({ status: 'loading', localUrl: null, publicUrl: null })
        setMsg('')
        refresh()
        let n = 30
        setLeft(30)
        return ctx.interval(() => {
          n -= 1
          if (n <= 0) { n = 30; refresh() }
          setLeft(n)
        }, 1000)
      }, [open])
      function toggle() {
        if (open) { setClosing(true); return }
        setClosing(false)
        setOpen(true)
      }
      function applyDays() {
        const n = Number(days)
        if (!(n > 0) || !(n <= 3650)) { setMsg('Enter 1-3650'); return }
        host.call('set-config', { sessionDays: n }).then((r) => {
          setMsg('Session length: ' + (r && r.sessionDays) + ' days')
        }).catch(() => { setMsg('Failed to apply') })
      }
      function qrBlock(label, url) {
        if (!url) return null
        let svg = null
        try { svg = matrixToSvg(buildQrMatrix(url, 1), 4, 4) } catch (e) { svg = null }
        if (!svg) return null
        return React.createElement('div', { className: 'dshqr-block' },
          React.createElement('div', { className: 'dshqr-qr', dangerouslySetInnerHTML: { __html: svg } }),
          React.createElement('span', { className: 'dshqr-kind' }, label),
          React.createElement('span', { className: 'dshqr-url' }, url)
        )
      }
      const localBlock = state.status === 'ready' ? qrBlock('Local network', state.localUrl) : null
      const publicBlock = state.status === 'ready' ? qrBlock('Public internet', state.publicUrl) : null
      return React.createElement('div', { className: wide ? 'dshqr-layer' : 'dshqr-layer dshqr-rail' },
        React.createElement('div', { className: 'dshqr-buttons' },
          React.createElement('button', {
            type: 'button',
            className: 'dshqr-badge',
            title: 'QR codes for connecting devices',
            'aria-label': 'Show QR codes to connect from another device',
            'aria-expanded': open,
            onClick: toggle
          },
            qrIcon(),
            wide ? React.createElement('span', { className: 'dshqr-label' }, 'QR codes') : null
          )
        ),
        open ? React.createElement('section', {
          className: 'dshqr-panel' + (closing ? ' dshqr-closing' : ''),
          'aria-label': 'Connect from another device',
          onAnimationEnd: (e) => {
            if (closing && e.animationName === 'dshqrFadeOut') { setOpen(false); setClosing(false) }
          }
        },
          React.createElement('header', { className: 'dshqr-header' },
            React.createElement('span', { className: 'dshqr-title' }, 'Scan to connect'),
            React.createElement('button', { type: 'button', className: 'dshqr-close', 'aria-label': 'Close', onClick: toggle }, '×')
          ),
          React.createElement('div', { className: 'dshqr-body' },
            state.status === 'loading' ? React.createElement('p', { className: 'dshqr-note' }, 'Starting reverse proxy…') :
            state.status === 'error' || !localBlock ? React.createElement('p', { className: 'dshqr-error' }, 'Reverse proxy is not ready. Try again in a moment.') :
            React.createElement(React.Fragment, null,
              React.createElement('p', { className: 'dshqr-count' }, 'New code in ' + left + 's'),
              localBlock,
              publicBlock || React.createElement('p', { className: 'dshqr-note' }, 'Public IP unavailable'),
              React.createElement('div', { className: 'dshqr-config' },
                React.createElement('span', { className: 'dshqr-configlabel' }, 'Session length (days)'),
                React.createElement('input', { className: 'dshqr-input', type: 'number', min: 1, max: 3650, value: days, onChange: (e) => setDays(e.target.value) }),
                React.createElement('button', { type: 'button', className: 'dshqr-apply', onClick: applyDays }, 'Apply')
              ),
              msg ? React.createElement('p', { className: 'dshqr-msg' }, msg) : null
            )
          )
        ) : null
      )
    }
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'qr-connect', order: -10 },
      QrConnect
    ))
  },
}
