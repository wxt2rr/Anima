import AppKit
import Foundation

func usageAndExit() -> Never {
  fputs("Usage: swift scripts/make_padded_icon.swift <input_png> <output_png> [scale]\n", stderr)
  fputs("  scale: 0.0-1.0, default 0.86 (keeps ~7% margin on each side)\n", stderr)
  exit(2)
}

let args = CommandLine.arguments
if args.count < 3 { usageAndExit() }

let inputPath = args[1]
let outputPath = args[2]
let scale = args.count >= 4 ? (Double(args[3]) ?? 0.86) : 0.86

if scale <= 0 || scale > 1 { usageAndExit() }

let inURL = URL(fileURLWithPath: inputPath)
let outURL = URL(fileURLWithPath: outputPath)

guard let src = NSImage(contentsOf: inURL) else {
  fputs("Failed to read input image: \(inputPath)\n", stderr)
  exit(1)
}

let pixels = 1024
let canvas = CGSize(width: pixels, height: pixels)
let targetSide = floor(Double(pixels) * scale)
let targetSize = CGSize(width: targetSide, height: targetSide)
let origin = CGPoint(x: (canvas.width - targetSize.width) / 2.0, y: (canvas.height - targetSize.height) / 2.0)

guard
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  )
else {
  fputs("Failed to create bitmap rep\n", stderr)
  exit(1)
}

guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else {
  fputs("Failed to create graphics context\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx
NSColor.clear.setFill()
NSBezierPath(rect: CGRect(origin: .zero, size: canvas)).fill()
src.draw(
  in: CGRect(origin: origin, size: targetSize),
  from: .zero,
  operation: .sourceOver,
  fraction: 1.0,
  respectFlipped: true,
  hints: [.interpolation: NSImageInterpolation.high]
)
ctx.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
  fputs("Failed to encode PNG\n", stderr)
  exit(1)
}

do {
  try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try png.write(to: outURL, options: .atomic)
} catch {
  fputs("Failed to write output image: \(error)\n", stderr)
  exit(1)
}
