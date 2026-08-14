#!/usr/bin/env node
/**
 * generate-glb-placeholders.js
 *
 * Generates minimal valid GLB (GLTF 2.0 binary) placeholder files for all
 * Chhath Radio 3D model paths. Each file is ~200 bytes — a single triangle
 * mesh that satisfies the GLTF spec so useGLTF() won't throw 404 errors.
 *
 * The scene uses procedural Three.js geometry visually. These placeholders
 * only exist to prevent network errors. Replace with real artist GLBs by
 * dropping them into public/chhath/models/ — no code changes needed.
 *
 * Usage:
 *   node scripts/generate-glb-placeholders.js
 *
 * Requires: Node.js built-ins only (fs, path) — no npm install needed.
 */

const fs = require('fs');
const path = require('path');

// ─── Model list (matches assetManifest.ts) ────────────────────────────────────
const MODELS = [
  'woman_arghya',
  'woman_soop',
  'man',
  'diya',
  'basket',
  'sugarcane',
  'coconut',
  'banana',
  'thekua',
  'marigold',
  'kalash',
  'temple',
  'boat',
  'ghats',
  'banana_plant',
];

const OUTPUT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'chhath', 'models');

// ─── Minimal valid GLB builder ────────────────────────────────────────────────
//
// GLTF 2.0 binary format:
//   12-byte header: magic(4) + version(4) + length(4)
//   Chunk 0 (JSON): chunkLength(4) + chunkType(4=0x4E4F534A) + chunkData
//   Chunk 1 (BIN):  chunkLength(4) + chunkType(4=0x004E4942) + chunkData
//
// The JSON describes a single triangle (3 vertices, positions only).
// The BIN chunk holds the 3 vec3 positions (36 bytes).

function buildMinimalGLB(name) {
  // 3 vertices of a tiny triangle (1cm scale, invisible in scene)
  const positions = new Float32Array([
    0.0,  0.0, 0.0,
    0.01, 0.0, 0.0,
    0.0,  0.01, 0.0,
  ]);
  const binData = Buffer.from(positions.buffer);
  const binLength = binData.length; // 36 bytes

  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'chhath-radio-placeholder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0 },
        mode: 4, // TRIANGLES
      }],
    }],
    accessors: [{
      bufferView: 0,
      componentType: 5126, // FLOAT
      count: 3,
      type: 'VEC3',
      min: [0.0, 0.0, 0.0],
      max: [0.01, 0.01, 0.0],
    }],
    bufferViews: [{
      buffer: 0,
      byteOffset: 0,
      byteLength: binLength,
      target: 34962, // ARRAY_BUFFER
    }],
    buffers: [{
      byteLength: binLength,
    }],
  });

  // JSON chunk must be padded to 4-byte boundary with spaces (0x20)
  const jsonBytes = Buffer.from(json, 'utf8');
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const jsonChunkData = Buffer.alloc(jsonPadded, 0x20);
  jsonBytes.copy(jsonChunkData);

  // BIN chunk must be padded to 4-byte boundary with zeros
  const binPadded = Math.ceil(binLength / 4) * 4;
  const binChunkData = Buffer.alloc(binPadded, 0x00);
  binData.copy(binChunkData);

  const totalLength =
    12 +                          // GLB header
    8 + jsonChunkData.length +    // JSON chunk header + data
    8 + binChunkData.length;      // BIN chunk header + data

  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // GLB header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // magic: 'glTF'
  glb.writeUInt32LE(2, offset);          offset += 4; // version: 2
  glb.writeUInt32LE(totalLength, offset); offset += 4; // total length

  // JSON chunk
  glb.writeUInt32LE(jsonChunkData.length, offset); offset += 4;
  glb.writeUInt32LE(0x4E4F534A, offset);            offset += 4; // 'JSON'
  jsonChunkData.copy(glb, offset);                  offset += jsonChunkData.length;

  // BIN chunk
  glb.writeUInt32LE(binChunkData.length, offset); offset += 4;
  glb.writeUInt32LE(0x004E4942, offset);           offset += 4; // 'BIN\0'
  binChunkData.copy(glb, offset);

  return glb;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let created = 0;
  let skipped = 0;

  for (const name of MODELS) {
    const filePath = path.join(OUTPUT_DIR, `${name}.glb`);

    // Don't overwrite real models (larger than our ~300-byte placeholder)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 1024) {
        console.log(`  SKIP  ${name}.glb  (${stat.size} bytes — looks like a real model)`);
        skipped++;
        continue;
      }
    }

    const glb = buildMinimalGLB(name);
    fs.writeFileSync(filePath, glb);
    console.log(`  WRITE ${name}.glb  (${glb.length} bytes)`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main();