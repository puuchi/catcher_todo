const test = require('node:test')
const assert = require('node:assert/strict')
const { clampBounds } = require('../src/window-position')

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } })

test('restores bubble entirely inside taskbar-excluding work area', () => {
  assert.deepEqual(clampBounds({ x: 1910, y: 1070, width: 36, height: 36 }, [display(0, 0, 1920, 1040)]), { x: 1884, y: 1004, width: 36, height: 36 })
})
test('retains negative DIP positions on a connected secondary display', () => {
  const bounds = { x: -1200, y: 50, width: 320, height: 480 }
  assert.deepEqual(clampBounds(bounds, [display(0, 0, 1920, 1040), display(-1280, 0, 1280, 984)]), bounds)
})
test('recovers disconnected monitor positions to the nearest remaining work area', () => {
  assert.deepEqual(clampBounds({ x: -1200, y: 50, width: 320, height: 480 }, [display(0, 0, 1920, 1040)]), { x: 0, y: 50, width: 320, height: 480 })
})
test('keeps a spanning window on the display containing most of it', () => {
  assert.deepEqual(clampBounds({ x: 1800, y: 100, width: 320, height: 480 }, [display(0, 0, 1920, 1040), display(1920, 0, 1280, 984)]), { x: 1920, y: 100, width: 320, height: 480 })
})
test('fits oversized windows after work area or resolution shrink', () => {
  assert.deepEqual(clampBounds({ x: 900, y: 700, width: 900, height: 700 }, [display(0, 0, 240, 200)]), { x: 0, y: 0, width: 240, height: 200 })
})
test('invalid stored positions and missing displays fail visibly to the caller', () => {
  for (const bounds of [null, {}, { x: NaN, y: 0, width: 36, height: 36 }, { x: 0, y: 0, width: 0, height: 36 }]) {
    assert.throws(() => clampBounds(bounds, [display(0, 0, 1920, 1040)]), /Invalid saved window bounds/)
  }
  assert.throws(() => clampBounds({ x: 0, y: 0, width: 36, height: 36 }, []), /No available display/)
})
