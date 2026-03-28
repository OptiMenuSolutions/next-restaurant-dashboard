// scripts/generate-icons.js
// Run with: node scripts/generate-icons.js
// Requires: npm install canvas
// Generates all PWA icon sizes from scratch using OptiMenu brand colors

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT_DIR = path.join(__dirname, '../public/icons');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const pad = size * 0.08;

  // Background — rounded rect
  const radius = size * 0.22;
  ctx.fillStyle = '#0a0908';
  ctx.beginPath();
  ctx.moveTo(pad + radius, pad);
  ctx.lineTo(size - pad - radius, pad);
  ctx.quadraticCurveTo(size - pad, pad, size - pad, pad + radius);
  ctx.lineTo(size - pad, size - pad - radius);
  ctx.quadraticCurveTo(size - pad, size - pad, size - pad - radius, size - pad);
  ctx.lineTo(pad + radius, size - pad);
  ctx.quadraticCurveTo(pad, size - pad, pad, size - pad - radius);
  ctx.lineTo(pad, pad + radius);
  ctx.quadraticCurveTo(pad, pad, pad + radius, pad);
  ctx.closePath();
  ctx.fill();

  // Teal accent ring
  ctx.strokeStyle = '#02a4ba';
  ctx.lineWidth = size * 0.025;
  ctx.stroke();

  // "OM" text — Playfair Display style approximation
  const fontSize = size * 0.36;
  ctx.fillStyle = '#e8e2d8';
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('OM', size / 2, size / 2 - size * 0.02);

  // Teal underline accent
  const lineY = size / 2 + fontSize * 0.55;
  const lineW = fontSize * 0.85;
  ctx.strokeStyle = '#02a4ba';
  ctx.lineWidth = size * 0.03;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size / 2 - lineW / 2, lineY);
  ctx.lineTo(size / 2 + lineW / 2, lineY);
  ctx.stroke();

  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(OUT_DIR, `icon-${size}x${size}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`✓ Generated ${filePath}`);
}

SIZES.forEach(generateIcon);
console.log('\nAll icons generated in public/icons/');
console.log('If you have a real logo, replace these with your branded icons.');