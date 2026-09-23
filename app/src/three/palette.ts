/**
 * Bureau — warm architect's atelier palette.
 *
 * Values are chosen so that every surface separates by VALUE first, hue second.
 * Rendered under ACES tone mapping with exposure ~1.0, so these read slightly
 * darker on screen than raw hex; they are pre-brightened to compensate.
 */

export const PAL = {
  // ── Structure ──────────────────────────────────────────────────────────────
  floorLight:   "#d9b585",   // oak plank, light board
  floorMid:     "#c39a6b",   // oak plank, mid board
  floorDark:    "#a97c52",   // oak plank, dark board
  floorGap:     "#6b4a2c",   // gap between planks

  wallPlaster:  "#efe2ca",   // warm cream plaster
  wallShadow:   "#ddc9a9",   // plaster in shadow / lower band
  wallTrim:     "#f7efe0",   // picture rail + crown, near-white
  skirting:     "#8a6644",   // stained skirting board

  beam:         "#7a5636",   // exposed ceiling beam
  beamDark:     "#5e4028",   // beam underside

  // ── Wood family (furniture) ────────────────────────────────────────────────
  oak:          "#c08d5c",   // light oak — desktops, table tops
  oakWarm:      "#b07f4e",   // oak in shadow
  walnut:       "#8a5a36",   // mid walnut — legs, frames
  walnutDark:   "#6b4327",   // dark walnut — cabinets
  mahogany:     "#5a3320",   // deepest wood — filing cabinet body
  birch:        "#dcc09a",   // pale birch — drawer fronts, panels

  // ── Metal ──────────────────────────────────────────────────────────────────
  brass:        "#b8944f",   // handles, lamp arms, hinges
  brassDark:    "#8a6c34",   // brass in shadow
  steel:        "#8e9297",   // tool steel, vise
  steelDark:    "#5c6066",   // dark steel
  iron:         "#3f4247",   // black iron — monitor, hardware

  // ── Soft goods ─────────────────────────────────────────────────────────────
  rugField:     "#8e3b2a",   // persian rug ground
  rugMotif:     "#c9873f",   // rug pattern amber
  rugDeep:      "#5e2318",   // rug border
  rugCream:     "#e0cbaa",   // rug highlight
  leather:      "#7a4a2e",   // chair seat
  linen:        "#e8dcc6",   // curtains, paper

  // ── Paper & drawing ────────────────────────────────────────────────────────
  paper:        "#f6efe1",   // fresh paper
  paperAged:    "#e6d8bd",   // aged blueprint backing
  blueprint:    "#2c5578",   // blueprint blue
  graphite:     "#4a4a4a",   // pencil lines

  // ── Glass & light ──────────────────────────────────────────────────────────
  glass:        "#bfe0f0",   // window pane tint
  skyWarm:      "#ffd9a0",   // sky seen through window (low sun)
  skyCool:      "#a8cde0",   // sky upper band
  bulb:         "#ffdfa8",   // incandescent filament
  lampGlow:     "#ff9d3d",   // lamp emission
  shadeOuter:   "#c8813a",   // lamp shade outside
  shadeInner:   "#ffcf8a",   // lamp shade lit inside

  // ── Plants ─────────────────────────────────────────────────────────────────
  leafDark:     "#3f6b3a",
  leafMid:      "#548a46",
  leafLight:    "#6fa657",
  terracotta:   "#b5653c",
  soil:         "#3a2a1e",

  // ── Books (spine colors) ───────────────────────────────────────────────────
  books: [
    "#8d3a32", "#2f5772", "#3f6b46", "#8a6a2c",
    "#5a3a6b", "#a8542f", "#37596b", "#6b4432",
  ] as const,

  // ── Agent identity ─────────────────────────────────────────────────────────
  agentMain:    "#4a90d9",   // main Claude — blue shirt
  agentSub:     "#e8944a",   // sub-agent — orange shirt
  skin:         "#e8b894",   // skin tone
  skinShadow:   "#c99870",
  hairDark:     "#3a2a20",
  hairMid:      "#5a3f2a",
  denim:        "#3f5a78",   // trousers
  shoe:         "#2e2620",

  // ── One colour per assistant ───────────────────────────────────────────────
  // The room can hold Claude, Codex and Gemini at once, so they have to be
  // told apart at a glance — before you read any label.
  srcClaude:    "#4a90d9",
  srcCodex:     "#3fb56b",
  srcGemini:    "#d9a13a",
  srcCopilot:   "#a468d4",
  srcCursor:    "#e8944a",
  srcCline:     "#46b6c4",
  srcOther:     "#9a8f7d",

  // ── Status ─────────────────────────────────────────────────────────────────
  // These light the halo above a figure's head. At full saturation, unlit and
  // un-tone-mapped, that halo was a neon ring hanging in a room made of wood
  // and lamplight — the one thing on screen that looked like a video game.
  // Muted to the room's own range: still six readable colours, none of them
  // brighter than the lamps.
  statIdle:     "#7d7266",
  statThink:    "#9b7fb8",
  statTool:     "#6f93b8",
  statWrite:    "#8fae72",
  statError:    "#e07a52",

  // ── Environment ────────────────────────────────────────────────────────────
  // The backdrop is a pool, not a wall: warm just behind the room, falling off
  // to near-black at the corners. Flat #150f07 everywhere read as a hole.
  bgWarm:       "#4a3116",   // directly behind the room
  bgMid:        "#291a0c",
  bgVoid:       "#120c06",   // corners, and the clear colour before first frame
  fogNear:      "#241a0e",
} as const

export type PaletteKey = keyof typeof PAL
