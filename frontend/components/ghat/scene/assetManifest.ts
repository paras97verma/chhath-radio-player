/**
 * assetManifest.ts — Central registry of all GLB model and texture paths.
 *
 * The scene uses procedural Three.js geometry by default.
 * When real artist-made GLBs are available, drop them into public/chhath/models/
 * and swap the procedural component with useGLTF(CHHATH_ASSETS.xxx) — no
 * architecture changes needed.
 *
 * CC0 / royalty-free sources used:
 *   - KhronosGroup glTF-Sample-Assets (Apache 2.0)
 *   - Sketchfab CC0 models
 *   - Poly Pizza CC0 models
 */

export const CHHATH_ASSETS = {
  characters: {
    /** Woman performing Arghya (offering water to sun) */
    womanArghya:  '/chhath/models/woman_arghya.glb',
    /** Woman carrying Soop (bamboo basket) */
    womanSoop:    '/chhath/models/woman_soop.glb',
    /** Male devotee */
    man:          '/chhath/models/man.glb',
  },
  props: {
    /** Clay diya lamp */
    diya:         '/chhath/models/diya.glb',
    /** Bamboo basket (soop) */
    basket:       '/chhath/models/basket.glb',
    /** Sugarcane stalk */
    sugarcane:    '/chhath/models/sugarcane.glb',
    /** Coconut */
    coconut:      '/chhath/models/coconut.glb',
    /** Banana */
    banana:       '/chhath/models/banana.glb',
    /** Thekua (traditional sweet) */
    thekua:       '/chhath/models/thekua.glb',
    /** Marigold flower */
    marigold:     '/chhath/models/marigold.glb',
    /** Kalash (sacred pot) */
    kalash:       '/chhath/models/kalash.glb',
  },
  environment: {
    /** Temple structure */
    temple:       '/chhath/models/temple.glb',
    /** Wooden boat */
    boat:         '/chhath/models/boat.glb',
    /** Ghat stone steps */
    ghats:        '/chhath/models/ghats.glb',
    /** Banana plant */
    bananaPlant:  '/chhath/models/banana_plant.glb',
  },
  textures: {
    /** Water normal map (WebP) */
    waterNormal:  '/chhath/textures/water_normal.webp',
    /** Stone diffuse texture (WebP) */
    stoneDiffuse: '/chhath/textures/stone_diffuse.webp',
    /** Wood diffuse texture (WebP) */
    woodDiffuse:  '/chhath/textures/wood_diffuse.webp',
  },
} as const;

export type ChhathAssets = typeof CHHATH_ASSETS;