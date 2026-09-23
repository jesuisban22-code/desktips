/**
 * Shared material library. Materials are created once and reused — this keeps
 * draw calls and GPU state changes low, which matters because the room has
 * several hundred meshes.
 *
 * Always import from here. Never construct a MeshStandardMaterial inline in a
 * component; if you need a new one, add it to this file so the whole room
 * stays visually consistent.
 */

import * as THREE from "three"
import { PAL } from "./palette"
import {
  woodTexture, woodRoughness, plasterTexture, plasterBump,
  rugTexture, paperTexture, blueprintTexture, sketchTexture, linenTexture,
  skyTexture, nightSkyTexture, metalRoughness, bookSpineTexture, shaftAlpha,
} from "./textures"

const cache = new Map<string, THREE.Material>()
function mem<T extends THREE.Material>(key: string, build: () => T): T {
  let m = cache.get(key)
  if (!m) { m = build(); cache.set(key, m) }
  return m as T
}

// ── Wood ─────────────────────────────────────────────────────────────────────

/**
 * @param repeat how many times the grain tiles across the surface. Use a small
 *        number for a large flat top (grain should read at furniture scale),
 *        larger for small parts.
 */
export function woodMat(
  light: string, dark: string, seed = 1, repeat = 1, rough = 0.62,
): THREE.MeshStandardMaterial {
  return mem(`wood-${light}-${dark}-${seed}-${repeat}-${rough}`, () => {
    const map = woodTexture(light, dark, seed).clone()
    map.repeat.set(repeat, repeat)
    map.needsUpdate = true
    const rm = woodRoughness(seed).clone()
    rm.repeat.set(repeat, repeat)
    rm.needsUpdate = true
    return new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rm,
      roughness: rough,
      metalness: 0.0,
      envMapIntensity: 0.35,
    })
  })
}

export const M = {
  // Furniture woods — each gets its own seed so no two pieces share grain
  oakTop:      () => woodMat(PAL.oak,        PAL.walnut,     3,  1.0, 0.55),
  oakPanel:    () => woodMat(PAL.oak,        PAL.oakWarm,    11, 1.6, 0.62),
  walnut:      () => woodMat(PAL.walnut,     PAL.walnutDark, 5,  2.0, 0.60),
  walnutLeg:   () => woodMat(PAL.walnut,     PAL.mahogany,   17, 3.0, 0.58),
  mahogany:    () => woodMat(PAL.mahogany,   "#3c1f12",      7,  1.4, 0.56),
  birch:       () => woodMat(PAL.birch,      PAL.oak,        13, 1.8, 0.66),
  benchTop:    () => woodMat(PAL.oakWarm,    PAL.walnutDark, 23, 1.2, 0.68),
  beam:        () => woodMat(PAL.beam,       PAL.beamDark,   29, 4.0, 0.80),

  // Floor — grain runs along each plank, tiled per-plank in Room
  floorLight:  () => woodMat(PAL.floorLight, "#c6a074",      31, 1.0, 0.58),
  floorMid:    () => woodMat("#cfaa7c",      "#b28a5e",      37, 1.0, 0.60),
  floorDark:   () => woodMat("#c09769",      PAL.floorDark,  41, 1.0, 0.62),

  // Walls
  plaster: () => mem("plaster", () => {
    const map = plasterTexture(PAL.wallPlaster, 5)
    map.repeat.set(3, 2)
    const bump = plasterBump(5)
    bump.repeat.set(3, 2)
    return new THREE.MeshStandardMaterial({
      map, bumpMap: bump, bumpScale: 0.012,
      roughness: 0.94, metalness: 0.0, envMapIntensity: 0.2,
    })
  }),

  plasterLower: () => mem("plasterLower", () => {
    const map = plasterTexture(PAL.wallShadow, 8)
    map.repeat.set(3, 1)
    return new THREE.MeshStandardMaterial({
      map, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.15,
    })
  }),

  trim:     () => mem("trim",     () => new THREE.MeshStandardMaterial({ color: PAL.wallTrim, roughness: 0.72 })),
  skirting: () => woodMat(PAL.skirting, PAL.walnutDark, 43, 5.0, 0.66),

  // Metals
  brass: () => mem("brass", () => new THREE.MeshStandardMaterial({
    color: PAL.brass, roughness: 0.34, metalness: 0.88,
    roughnessMap: metalRoughness(33), envMapIntensity: 1.1,
  })),
  brassDark: () => mem("brassDark", () => new THREE.MeshStandardMaterial({
    color: PAL.brassDark, roughness: 0.46, metalness: 0.82, envMapIntensity: 0.9,
  })),
  steel: () => mem("steel", () => new THREE.MeshStandardMaterial({
    color: PAL.steel, roughness: 0.30, metalness: 0.92,
    roughnessMap: metalRoughness(51), envMapIntensity: 1.2,
  })),
  steelDark: () => mem("steelDark", () => new THREE.MeshStandardMaterial({
    color: PAL.steelDark, roughness: 0.42, metalness: 0.85, envMapIntensity: 0.9,
  })),
  iron: () => mem("iron", () => new THREE.MeshStandardMaterial({
    color: PAL.iron, roughness: 0.55, metalness: 0.70, envMapIntensity: 0.6,
  })),

  // Soft goods
  rug: () => mem("rug", () => {
    const map = rugTexture(PAL.rugField, PAL.rugMotif, PAL.rugDeep, PAL.rugCream)
    return new THREE.MeshStandardMaterial({
      map, roughness: 0.97, metalness: 0.0, envMapIntensity: 0.1,
    })
  }),
  leather: () => mem("leather", () => new THREE.MeshStandardMaterial({
    color: PAL.leather, roughness: 0.66, metalness: 0.0, envMapIntensity: 0.4,
  })),
  linen: () => mem("linen", () => {
    const map = linenTexture(PAL.linen, 21)
    map.repeat.set(2, 3)
    return new THREE.MeshStandardMaterial({
      map, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
    })
  }),

  // Paper
  paper: () => mem("paper", () => new THREE.MeshStandardMaterial({
    map: paperTexture(PAL.paper, 12), roughness: 0.88, metalness: 0.0,
  })),
  paperAged: () => mem("paperAged", () => new THREE.MeshStandardMaterial({
    map: paperTexture(PAL.paperAged, 14), roughness: 0.90, metalness: 0.0,
  })),
  blueprint: () => mem("blueprint", () => new THREE.MeshStandardMaterial({
    map: blueprintTexture(), roughness: 0.86, metalness: 0.0,
  })),
  sketch: () => mem("sketch", () => new THREE.MeshStandardMaterial({
    map: sketchTexture(), roughness: 0.88, metalness: 0.0,
  })),

  // Glass & light
  glass: () => mem("glass", () => new THREE.MeshPhysicalMaterial({
    color: PAL.glass, roughness: 0.05, metalness: 0.0,
    transmission: 0.92, thickness: 0.02, ior: 1.45,
    transparent: true, opacity: 0.42, envMapIntensity: 1.4,
  })),
  /**
   * The sky behind the windows. Its colour is tinted by the time of day
   * (Lighting.tsx), and `userData.night.value` (0–1) adds the city at night —
   * lit windows and stars — on top. Added in the shader rather than as a plane
   * in front: the window glass refracts only opaque things, and a transparent
   * overlay behind it would simply not be seen.
   */
  sky: () => mem("sky", () => {
    const m = new THREE.MeshBasicMaterial({ map: skyTexture(PAL.skyWarm, PAL.skyCool), toneMapped: false })
    const night = { value: 0 }
    m.userData.night = night
    m.onBeforeCompile = shader => {
      shader.uniforms.uNight = night
      shader.uniforms.uNightMap = { value: nightSkyTexture() }
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform sampler2D uNightMap;")
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\n  diffuseColor.rgb += texture2D(uNightMap, vMapUv).rgb * uNight;",
        )
    }
    return m
  }),
  /**
   * Lamp shade, seen from outside. Faintly emissive on purpose: fabric passes
   * light, so a lit shade glows rather than sitting there as a tan drum. Kept
   * well under the bloom threshold so only the bulb itself blooms.
   */
  shadeOuter: () => mem("shadeOuter", () => new THREE.MeshStandardMaterial({
    color: PAL.shadeOuter, roughness: 0.72, metalness: 0.06,
    emissive: new THREE.Color(PAL.lampGlow), emissiveIntensity: 0.34,
    side: THREE.DoubleSide,
  })),
  shadeInner: () => mem("shadeInner", () => new THREE.MeshStandardMaterial({
    color: PAL.shadeInner, roughness: 0.85,
    emissive: new THREE.Color(PAL.lampGlow), emissiveIntensity: 0.9,
    side: THREE.BackSide,
  })),
  /** Translucent top panel of a drum shade — glows without showing the bulb. */
  diffuser: () => mem("diffuser", () => new THREE.MeshStandardMaterial({
    color: PAL.shadeInner, roughness: 0.9,
    emissive: new THREE.Color(PAL.lampGlow), emissiveIntensity: 0.45,
    side: THREE.DoubleSide,
  })),
  bulb: () => mem("bulb", () => new THREE.MeshStandardMaterial({
    color: PAL.bulb, emissive: new THREE.Color(PAL.bulb),
    emissiveIntensity: 4.0, toneMapped: false,
  })),

  // Plants
  leafDark:  () => mem("leafDark",  () => new THREE.MeshStandardMaterial({ color: PAL.leafDark,  roughness: 0.78, side: THREE.DoubleSide })),
  leafMid:   () => mem("leafMid",   () => new THREE.MeshStandardMaterial({ color: PAL.leafMid,   roughness: 0.74, side: THREE.DoubleSide })),
  leafLight: () => mem("leafLight", () => new THREE.MeshStandardMaterial({ color: PAL.leafLight, roughness: 0.70, side: THREE.DoubleSide })),
  terracotta:() => mem("terracotta",() => new THREE.MeshStandardMaterial({ color: PAL.terracotta,roughness: 0.88 })),
  soil:      () => mem("soil",      () => new THREE.MeshStandardMaterial({ color: PAL.soil,      roughness: 1.0 })),

  // Character
  skin:  () => mem("skin",  () => new THREE.MeshStandardMaterial({ color: PAL.skin,     roughness: 0.76, envMapIntensity: 0.35 })),
  hair:  () => mem("hair",  () => new THREE.MeshStandardMaterial({ color: PAL.hairDark, roughness: 0.68 })),
  hair2: () => mem("hair2", () => new THREE.MeshStandardMaterial({ color: PAL.hairMid,  roughness: 0.70 })),
  /** Any hair colour, for the figures that are not one of the first two. */
  hairTone: (color: string) => mem(`hair-${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.70 })),
  /** The bench terminal: beige plastic, its darker trim, its keycaps. */
  crt:      () => mem("crt",      () => new THREE.MeshStandardMaterial({ color: "#cdc3aa", roughness: 0.62 })),
  crtTrim:  () => mem("crtTrim",  () => new THREE.MeshStandardMaterial({ color: "#5a554c", roughness: 0.70 })),
  keycaps:  () => mem("keycaps",  () => new THREE.MeshStandardMaterial({ color: "#8f8676", roughness: 0.75 })),
  /** A faint sheen over the wall clock's face. Not the windows' glass: that
   *  one refracts, and a transmission pass for a clock face buys nothing. */
  clockGlass: () => mem("clockGlass", () => new THREE.MeshStandardMaterial({
    color: "#ffffff", transparent: true, opacity: 0.10, roughness: 0.04, metalness: 0.1, depthWrite: false,
  })),
  /** Spectacle frames and headphone plastic. */
  frame: () => mem("frame", () => new THREE.MeshStandardMaterial({ color: "#1c1814", roughness: 0.45, metalness: 0.2 })),
  lens:  () => mem("lens", () => new THREE.MeshStandardMaterial({
    color: "#a9c4cf", roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.35,
  })),
  denim: () => mem("denim", () => new THREE.MeshStandardMaterial({ color: PAL.denim,    roughness: 0.86 })),
  shoe:  () => mem("shoe",  () => new THREE.MeshStandardMaterial({ color: PAL.shoe,     roughness: 0.58 })),
  eye:   () => mem("eye",   () => new THREE.MeshStandardMaterial({ color: "#241c16",    roughness: 0.30 })),

  /** Shirt colour varies per agent — not memoised by a fixed key. */
  shirt: (color: string) => mem(`shirt-${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.82, envMapIntensity: 0.3,
  })),

  // Character extras
  skinShadowMat: () => mem("skinShadow", () => new THREE.MeshStandardMaterial({
    color: PAL.skinShadow, roughness: 0.80,
  })),
  skinTone: (color: string) => mem(`skinTone-${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.76, envMapIntensity: 0.35,
  })),
  hairTie: () => mem("hairTie", () => new THREE.MeshStandardMaterial({
    color: "#4a3a46", roughness: 0.80,
  })),
  belt: () => mem("belt", () => new THREE.MeshStandardMaterial({
    color: "#4a3428", roughness: 0.58,
  })),
  shoeSole: () => mem("shoeSole", () => new THREE.MeshStandardMaterial({
    color: "#1d1814", roughness: 0.92,
  })),
  eyeWhite: () => mem("eyeWhite", () => new THREE.MeshStandardMaterial({
    color: "#efe8e0", roughness: 0.34,
  })),
  mouth: () => mem("mouth", () => new THREE.MeshStandardMaterial({
    color: "#9c5f4e", roughness: 0.66,
  })),

  /** Slightly darkened shirt colour for plackets and collars. */
  shirtPlacket: (color: string) => mem(`placket-${color}`, () => {
    const c = new THREE.Color(color)
    c.multiplyScalar(0.82)
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.84 })
  }),

  // Props
  glaze: (color: string) => mem(`glaze-${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.22, metalness: 0.04, envMapIntensity: 0.8,
  })),
  coffee: () => mem("coffee", () => new THREE.MeshStandardMaterial({
    color: "#3a2216", roughness: 0.18, metalness: 0.05, envMapIntensity: 1.0,
  })),
  notebook: () => mem("notebook", () => new THREE.MeshStandardMaterial({
    color: "#5a4a3a", roughness: 0.72,
  })),
  walnutDarkMat: () => mem("walnutDarkMat", () => new THREE.MeshStandardMaterial({
    color: PAL.walnutDark, roughness: 0.78,
  })),
  pencil: (color: string) => mem(`pencil-${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.62,
  })),
  pencilTip: () => mem("pencilTip", () => new THREE.MeshStandardMaterial({
    color: PAL.graphite, roughness: 0.50,
  })),
  cord: () => mem("cord", () => new THREE.MeshStandardMaterial({
    color: "#9a8a6a", roughness: 0.95,
  })),
  crate: () => mem("crate", () => new THREE.MeshStandardMaterial({
    color: "#b9925e", roughness: 0.90,
  })),

  /** The base course the whole room stands on — a model's plinth. */
  plinth: () => woodMat("#4a2f1c", "#2c1a0e", 53, 3.0, 0.82),

  /** Kraft paper, the outside of a rolled drawing. */
  kraft: () => mem("kraft", () => new THREE.MeshStandardMaterial({
    map: paperTexture("#cbab7d", 26), roughness: 0.94, metalness: 0.0,
  })),

  /** The string tied round one. */
  twine: () => mem("twine", () => new THREE.MeshStandardMaterial({
    color: "#8d7a56", roughness: 1.0,
  })),

  /** Manila folder carried between stations. */
  folder: (color: string) => mem(`folder-${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.88, metalness: 0.0,
  })),

  /** Book spine — one per (color, seed) pair. */
  bookSpine: (color: string, seed: number) => mem(`book-${color}-${seed}`, () =>
    new THREE.MeshStandardMaterial({ map: bookSpineTexture(color, seed), roughness: 0.84 }),
  ),

  /** Emissive status material for halos / indicators. */
  status: (color: string, intensity = 0.55) => mem(`status-${color}-${intensity}`, () =>
    new THREE.MeshStandardMaterial({
      color, emissive: new THREE.Color(color), emissiveIntensity: intensity,
      roughness: 0.45,
      // Tone-mapped ON PURPOSE. Opting out put this ring outside the exposure
      // the whole rest of the image obeys, and it clipped to a flat neon.
    }),
  ),

  /**
   * Soft additive glow for light shafts.
   *
   * The alphaMap is what makes it read as light: a bare box, however faint,
   * still has a hard silhouette and looks like a pane of glass leaning in the
   * room. The ramp takes the edges to nothing.
   */
  lightShaft: (color = PAL.skyWarm, opacity = 0.05) => mem(`shaft-${color}-${opacity}`, () =>
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      alphaMap: shaftAlpha(),
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }),
  ),

  /** Monitor screen — faintly glowing dark panel. */
  screen: () => mem("screen", () => new THREE.MeshStandardMaterial({
    color: "#10161d", roughness: 0.18, metalness: 0.3,
    emissive: new THREE.Color("#1d3348"), emissiveIntensity: 0.55,
  })),

  chalk: () => mem("chalk", () => new THREE.MeshStandardMaterial({ color: "#efe7d6", roughness: 0.95 })),
  cork:  () => mem("cork",  () => new THREE.MeshStandardMaterial({ color: "#b98c5a", roughness: 0.95 })),
  slate: () => mem("slate", () => new THREE.MeshStandardMaterial({ color: "#2f3a38", roughness: 0.88 })),
} as const
