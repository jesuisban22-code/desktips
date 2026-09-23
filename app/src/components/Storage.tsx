/**
 * Storage.tsx — the things that hold things.
 *
 * Bookshelf     carcass + cornice + plinth, filled with deliberately untidy books
 * FilingCabinet four drawers with real reveal gaps, one pulled open with files
 * Pegboard      wall-mounted tool board above the workbench
 * WallShelf     a floating shelf on brass brackets
 *
 * The tell of a believable bookshelf is irregularity. Perfectly aligned rows
 * read as computer-generated; leaning books, flat stacks and a half-empty bay
 * read as a shelf somebody actually uses.
 */

import { useMemo, useRef, type ReactNode } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { mergeBufferGeometries } from "three-stdlib"
import { workshop } from "../anim/workshop"
import { wake } from "../anim/activity"
import { useWeld } from "./StaticBatch"
import {
  chamfer, bevelPanel, moulding, turned, rolledSheet, rng, jitter,
  type Profile,
} from "../three/kit"
import { M } from "../three/materials"
import { PAL } from "../three/palette"

export type PieceProps = {
  position?: [number, number, number]
  rotation?: [number, number, number]
}

// ── Local lathe profiles ─────────────────────────────────────────────────────

const D_PULL: Profile = [
  [0.000, 0.000], [0.013, 0.000], [0.013, 0.052], [0.000, 0.052],
]

const PEG_HOOK: Profile = [
  [0.000, 0.000], [0.006, 0.000], [0.006, 0.038], [0.000, 0.038],
]

// ═══════════════════════════════════════════════════════════════════════════
// Bookshelf
// ═══════════════════════════════════════════════════════════════════════════

const SHELF_W = 2.00
const SHELF_H = 2.60
const SHELF_D = 0.34

/** Bay heights, tallest at the bottom — that's how real shelves get loaded. */
const BAY_TOPS = [0.16, 0.60, 1.05, 1.47, 1.86, 2.24]

function Books() {
  const { merged, mats } = useMemo(() => {
    const r = rng(0xB00C5)
    // One geometry bucket per spine colour keeps this to 8 draw calls
    const buckets: THREE.BufferGeometry[][] = PAL.books.map(() => [])

    for (let bay = 0; bay < BAY_TOPS.length - 1; bay++) {
      const yBase   = BAY_TOPS[bay] + 0.022
      const bayTall = BAY_TOPS[bay + 1] - BAY_TOPS[bay] - 0.046
      // One bay is left deliberately sparse
      const sparse  = bay === 3
      let x = -SHELF_W / 2 + 0.055

      const limit = SHELF_W / 2 - 0.055
      while (x < limit) {
        const roll = r()

        // ── a flat stack, occasionally ─────────────────────────────────
        if (roll < 0.10 && x < limit - 0.20) {
          const n = 2 + Math.floor(r() * 3)
          const w = 0.135 + r() * 0.045
          let y = yBase
          for (let k = 0; k < n; k++) {
            const th = 0.026 + r() * 0.018
            const ci = Math.floor(r() * PAL.books.length)
            buckets[ci].push(
              chamfer(w, th, SHELF_D * 0.70, 0.003, 1).clone()
                .translate(x + w / 2, y + th / 2, -0.012)
            )
            y += th + 0.002
          }
          x += w + 0.028
          continue
        }

        // ── leave a gap in the sparse bay ──────────────────────────────
        if (sparse && roll > 0.62) { x += 0.09 + r() * 0.10; continue }

        // ── an upright book, sometimes leaning ─────────────────────────
        const th  = 0.026 + r() * 0.030
        const h   = Math.min(bayTall, 0.19 + r() * 0.11)
        const dep = SHELF_D * (0.62 + r() * 0.22)
        const ci  = Math.floor(r() * PAL.books.length)

        // 22% lean against their neighbour
        const lean = r() < 0.22 ? (0.10 + r() * 0.14) * (r() < 0.5 ? 1 : -1) : 0

        const g = chamfer(th, h, dep, 0.003, 1).clone()
        if (lean !== 0) {
          g.rotateZ(lean)
          // Rotating about the centre lifts the base; drop it back onto the shelf
          g.translate(
            x + th / 2,
            yBase + h / 2 - Math.abs(Math.sin(lean)) * h * 0.06,
            -0.012,
          )
        } else {
          g.translate(x + th / 2, yBase + h / 2, -0.012)
        }
        buckets[ci].push(g)

        x += th + 0.004 + (lean !== 0 ? 0.012 : 0) + r() * 0.006
      }

      // ── a few volumes lying on top of the upright row ────────────────
      if (r() < 0.55) {
        const n = 1 + Math.floor(r() * 2)
        const sx = -SHELF_W / 2 + 0.12 + r() * (SHELF_W - 0.5)
        let y = yBase + 0.215
        for (let k = 0; k < n; k++) {
          const w  = 0.15 + r() * 0.06
          const th = 0.024 + r() * 0.014
          const ci = Math.floor(r() * PAL.books.length)
          const g = chamfer(w, th, SHELF_D * 0.66, 0.003, 1).clone()
          g.rotateY(jitter(r, 0.05))
          g.translate(sx + w / 2, y + th / 2, -0.014)
          buckets[ci].push(g)
          y += th + 0.002
        }
      }
    }

    return {
      merged: buckets.map(b => (b.length ? mergeBufferGeometries(b, false) : null)),
      mats:   PAL.books.map((c, i) => M.bookSpine(c, i * 13 + 5)),
    }
  }, [])

  return (
    <group>
      {merged.map((g, i) =>
        g ? <mesh key={i} geometry={g} material={mats[i]} castShadow receiveShadow /> : null
      )}
    </group>
  )
}

export function Bookshelf({ position = [2.20, 0, -5.55], rotation = [0, 0, 0] }: PieceProps) {
  const sideMat  = M.walnut()
  const shelfMat = M.oakPanel()

  return (
    <group name="Bookshelf" position={position} rotation={rotation}>
      {/* plinth */}
      <mesh
        geometry={chamfer(SHELF_W, 0.15, SHELF_D * 0.92, 0.006)}
        material={sideMat}
        position={[0, 0.075, -0.012]}
        castShadow receiveShadow
      />
      {/* sides */}
      {[-1, 1].map(s => (
        <mesh
          key={s}
          geometry={chamfer(0.030, SHELF_H - 0.15, SHELF_D, 0.005)}
          material={sideMat}
          position={[s * (SHELF_W / 2 - 0.015), 0.15 + (SHELF_H - 0.15) / 2, 0]}
          castShadow receiveShadow
        />
      ))}
      {/* back panel, set into a rebate */}
      <mesh
        geometry={chamfer(SHELF_W - 0.050, SHELF_H - 0.17, 0.012, 0.003)}
        material={M.birch()}
        position={[0, 0.16 + (SHELF_H - 0.17) / 2, -SHELF_D / 2 + 0.016]}
        receiveShadow
      />
      {/* shelves */}
      {BAY_TOPS.map((y, i) => (
        <mesh
          key={i}
          geometry={chamfer(SHELF_W - 0.062, 0.024, SHELF_D - 0.028, 0.005)}
          material={shelfMat}
          position={[0, y + 0.012, 0.006]}
          castShadow receiveShadow
        />
      ))}
      {/* cornice */}
      <mesh
        geometry={moulding(SHELF_W + 0.055, 0.085, 0.058)}
        material={sideMat}
        position={[0, SHELF_H - 0.030, SHELF_D / 2 - 0.010]}
        rotation={[Math.PI, 0, 0]}
        castShadow
      />
      <mesh
        geometry={chamfer(SHELF_W + 0.070, 0.024, SHELF_D + 0.045, 0.006)}
        material={shelfMat}
        position={[0, SHELF_H + 0.012, 0]}
        castShadow
      />

      <Books />

      {/* a couple of rolled drawings slotted in the sparse bay */}
      {[0, 1].map(i => (
        <mesh
          key={i}
          geometry={rolledSheet(0.40, 0.030)}
          material={i === 0 ? M.blueprint() : M.paperAged()}
          position={[0.34 + i * 0.075, BAY_TOPS[3] + 0.225, -0.02]}
          rotation={[0, 0, 0.10 - i * 0.16]}
          castShadow
        />
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Filing cabinet
// ═══════════════════════════════════════════════════════════════════════════

const FC = { w: 0.52, h: 1.34, d: 0.62, reveal: 0.006, drawers: 4 }

function DrawerFront({ y, open, label }: { y: number; open: number; label: boolean }) {
  const fh = (FC.h - 0.16 - FC.reveal * (FC.drawers + 1)) / FC.drawers
  const fw = FC.w - FC.reveal * 2

  // Flush in the opening, not stuck on the outside: at FC.d/2 the panel's whole
  // 26 mm sat proud of the carcass and the drawers read as glued-on boards.
  return (
    <group position={[0, y, FC.d / 2 - 0.013 + open]}>
      <mesh
        geometry={bevelPanel(fw, fh, 0.026, 0.005)}
        material={M.walnut()}
        castShadow receiveShadow
      />
      {/* brass D-pull on two posts */}
      {[-1, 1].map(s => (
        <mesh
          key={s}
          geometry={turned(D_PULL, 8)}
          material={M.brass()}
          position={[s * 0.055, -fh * 0.06, 0.020]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        />
      ))}
      <mesh
        geometry={chamfer(0.140, 0.012, 0.012, 0.005)}
        material={M.brass()}
        position={[0, -fh * 0.06, 0.046]}
        castShadow
      />
      {/* label holder + card */}
      {label && (
        <group position={[0, fh * 0.26, 0.020]}>
          <mesh geometry={chamfer(0.112, 0.034, 0.006, 0.002)} material={M.brass()} />
          <mesh
            geometry={chamfer(0.098, 0.022, 0.002, 0.001)}
            material={M.paper()}
            position={[0, 0, 0.004]}
          />
        </group>
      )}
    </group>
  )
}

export function FilingCabinet({
  position = [4.70, 0, -4.60], rotation = [0, 0, 0],
}: PieceProps) {
  const fh = (FC.h - 0.16 - FC.reveal * (FC.drawers + 1)) / FC.drawers
  const openIndex = 1          // second drawer from the top is pulled out
  const openBy    = 0.225

  const folders = useMemo(() => {
    const r = rng(4242)
    return Array.from({ length: 7 }, (_, i) => ({
      x:    -0.18 + i * 0.052,
      lean: jitter(r, 0.10),
      h:    0.20 + r() * 0.045,
      aged: r() < 0.5,
    }))
  }, [])

  return (
    <group name="FilingCabinet" position={position} rotation={rotation}>
      {/* plinth */}
      <mesh
        geometry={chamfer(FC.w - 0.020, 0.075, FC.d - 0.020, 0.005)}
        material={M.mahogany()}
        position={[0, 0.0375, 0]}
        castShadow receiveShadow
      />
      {/* carcass */}
      <mesh
        geometry={chamfer(FC.w, FC.h - 0.15, FC.d, 0.008)}
        material={M.mahogany()}
        position={[0, 0.075 + (FC.h - 0.15) / 2, 0]}
        castShadow receiveShadow
      />
      {/* top slab, slight overhang */}
      <mesh
        geometry={chamfer(FC.w + 0.024, 0.030, FC.d + 0.024, 0.007)}
        material={M.walnut()}
        position={[0, FC.h - 0.060, 0]}
        castShadow receiveShadow
      />

      {/* drawer fronts — all but the one that slides */}
      {Array.from({ length: FC.drawers }, (_, i) => {
        if (i === openIndex) return null
        const y = FC.h - 0.105 - fh / 2 - i * (fh + FC.reveal)
        return <DrawerFront key={i} y={y} open={0} label />
      })}

      <SlidingDrawer openBy={openBy}>
        <DrawerFront y={FC.h - 0.105 - fh / 2 - openIndex * (fh + FC.reveal)} open={openBy} label />

      {/* The pulled-out drawer. It used to be a single panel with the files
          hanging in the air beside it; now it is a box — two sides, a back and
          a bottom — that the files actually stand in. Everything behind
          z = FC.d/2 is inside the carcass and never seen. */}
      <group position={[0, FC.h - 0.105 - fh / 2 - openIndex * (fh + FC.reveal), 0]}>
        {[-1, 1].map(sx => (
          <mesh
            key={sx}
            geometry={chamfer(0.012, 0.235, 0.520, 0.003)}
            material={M.birch()}
            position={[sx * 0.244, -0.012, 0.245]}
            castShadow receiveShadow
          />
        ))}
        <mesh
          geometry={chamfer(0.476, 0.012, 0.520, 0.003)}
          material={M.birch()}
          position={[0, -0.124, 0.245]}
          castShadow receiveShadow
        />
        <mesh
          geometry={chamfer(0.476, 0.235, 0.012, 0.003)}
          material={M.birch()}
          position={[0, -0.012, -0.009]}
          castShadow
        />
        {folders.map((f, i) => (
          <mesh
            key={i}
            geometry={chamfer(0.042, f.h, 0.30, 0.003)}
            material={f.aged ? M.paperAged() : M.paper()}
            position={[f.x, -0.118 + f.h / 2, 0.300]}
            rotation={[0, 0, f.lean]}
            castShadow
          />
        ))}
      </group>
      </SlidingDrawer>
    </group>
  )
}

/**
 * The drawer that actually moves: authored in its pulled-out position, and
 * slid back into the carcass by `openBy` whenever nobody is working at the
 * cabinet (anim/workshop). It used to stand open for ever, which said nothing.
 * `userData.dynamic` keeps it out of the static batch.
 */
function SlidingDrawer({ openBy, children }: { openBy: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useWeld(ref)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const want = workshop.cabinet.size > 0 ? 0 : -openBy
    const next = g.position.z + (want - g.position.z) * Math.min(1, 7 * dt)
    if (Math.abs(want - next) > 0.0005) wake(120)
    g.position.z = next
  })
  return (
    <group ref={ref} position={[0, 0, -openBy]} userData={{ dynamic: true }}>
      {children}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pegboard — lies in the Y-Z plane on the left wall, facing +X
// ═══════════════════════════════════════════════════════════════════════════

const PB = { w: 1.80, h: 0.90 }

function Tool({
  kind, z, y,
}: {
  kind: "saw" | "chisel" | "square" | "mallet" | "rule"
  z: number
  y: number
}) {
  switch (kind) {
    case "saw":
      return (
        <group position={[0.045, y, z]} rotation={[0, 0, -0.06]}>
          {/* blade — tapering toward the toe */}
          <mesh
            geometry={chamfer(0.004, 0.115, 0.46, 0.0015)}
            material={M.steel()}
            castShadow
          />
          {/* shaped handle */}
          <mesh
            geometry={chamfer(0.020, 0.135, 0.115, 0.026)}
            material={M.walnut()}
            position={[0, -0.010, -0.275]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.022, 0.060, 0.050, 0.020)}
            material={M.walnut()}
            position={[0, 0.050, -0.238]}
            castShadow
          />
        </group>
      )
    case "chisel":
      return (
        <group position={[0.038, y, z]}>
          <mesh geometry={chamfer(0.003, 0.150, 0.020, 0.001)} material={M.steel()} castShadow />
          <mesh
            geometry={chamfer(0.020, 0.105, 0.026, 0.009)}
            material={M.walnutLeg()}
            position={[0, -0.125, 0]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.022, 0.012, 0.028, 0.004)}
            material={M.brass()}
            position={[0, -0.072, 0]}
          />
        </group>
      )
    case "square":
      return (
        <group position={[0.040, y, z]} rotation={[0.05, 0, 0]}>
          <mesh geometry={chamfer(0.004, 0.018, 0.185, 0.0015)} material={M.steel()} castShadow />
          <mesh
            geometry={chamfer(0.016, 0.145, 0.028, 0.004)}
            material={M.walnutLeg()}
            position={[0, -0.066, -0.082]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.018, 0.020, 0.030, 0.004)}
            material={M.brass()}
            position={[0, 0.004, -0.082]}
          />
        </group>
      )
    case "mallet":
      return (
        <group position={[0.048, y, z]} rotation={[0, 0, 0.10]}>
          <mesh geometry={chamfer(0.062, 0.070, 0.125, 0.012)} material={M.walnut()} castShadow />
          <mesh
            geometry={chamfer(0.026, 0.185, 0.026, 0.011)}
            material={M.walnutLeg()}
            position={[0, -0.125, 0]}
            castShadow
          />
        </group>
      )
    case "rule":
      return (
        <mesh
          geometry={chamfer(0.003, 0.270, 0.028, 0.001)}
          material={M.steel()}
          position={[0.036, y, z]}
          castShadow
        />
      )
  }
}

export function Pegboard({
  position = [-5.88, 1.70, 1.40], rotation = [0, 0, 0],
}: PieceProps) {
  // Peg holes as small dark discs merged into one geometry
  const holes = useMemo(() => {
    const gs: THREE.BufferGeometry[] = []
    const cols = Math.floor(PB.w / 0.075)
    const rows = Math.floor(PB.h / 0.075)
    for (let c = 0; c < cols; c++) {
      for (let rr = 0; rr < rows; rr++) {
        const g = new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 6)
        g.rotateZ(Math.PI / 2)
        g.translate(
          0.014,
          -PB.h / 2 + 0.040 + rr * 0.075,
          -PB.w / 2 + 0.040 + c * 0.075,
        )
        gs.push(g)
      }
    }
    return mergeBufferGeometries(gs, false)
  }, [])

  return (
    <group name="Pegboard" position={position} rotation={rotation}>
      {/* backing board */}
      <mesh
        geometry={chamfer(0.024, PB.h, PB.w, 0.005)}
        material={M.cork()}
        castShadow receiveShadow
      />
      {/* frame */}
      {[[0, PB.h / 2 + 0.014, 0], [0, -PB.h / 2 - 0.014, 0]].map((p, i) => (
        <mesh
          key={`h${i}`}
          geometry={chamfer(0.030, 0.028, PB.w + 0.056, 0.005)}
          material={M.walnut()}
          position={p as [number, number, number]}
          castShadow
        />
      ))}
      {[-1, 1].map(s => (
        <mesh
          key={`v${s}`}
          geometry={chamfer(0.030, PB.h, 0.028, 0.005)}
          material={M.walnut()}
          position={[0, 0, s * (PB.w / 2 + 0.014)]}
          castShadow
        />
      ))}

      {holes && <mesh geometry={holes} material={M.iron()} />}

      {/* brass hooks */}
      {[-0.72, -0.40, -0.10, 0.22, 0.52, 0.78].map((z, i) => (
        <mesh
          key={i}
          geometry={turned(PEG_HOOK, 6)}
          material={M.brass()}
          position={[0.026, 0.30, z]}
          rotation={[0, 0, -Math.PI / 2]}
          castShadow
        />
      ))}

      {/* the tools */}
      <Tool kind="saw"    z={-0.52} y={0.10} />
      <Tool kind="chisel" z={ 0.04} y={0.22} />
      <Tool kind="chisel" z={ 0.10} y={0.22} />
      <Tool kind="chisel" z={ 0.16} y={0.22} />
      <Tool kind="square" z={ 0.42} y={0.18} />
      <Tool kind="mallet" z={ 0.70} y={0.24} />
      <Tool kind="rule"   z={-0.14} y={-0.16} />

      {/* a coil of cord hanging from a hook */}
      <mesh
        geometry={new THREE.TorusGeometry(0.065, 0.010, 8, 28)}
        material={M.cord()}
        position={[0.040, -0.06, 0.78]}
        rotation={[0, Math.PI / 2, 0]}
        castShadow
      />

      {/* pinned notes */}
      {[
        { z: -0.86, y: -0.24, rot:  0.08 },
        { z: -0.70, y: -0.30, rot: -0.11 },
      ].map((n, i) => (
        <mesh
          key={i}
          geometry={chamfer(0.002, 0.105, 0.082, 0.001)}
          material={M.paper()}
          position={[0.016, n.y, n.z]}
          rotation={[n.rot, 0, 0]}
        />
      ))}
    </group>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Wall shelf
// ═══════════════════════════════════════════════════════════════════════════

export function WallShelf({
  position = [-0.20, 1.70, -5.82], rotation = [0, 0, 0],
}: PieceProps) {
  const books = useMemo(() => {
    const r = rng(808)
    const gs: Array<{ g: THREE.BufferGeometry; mi: number }> = []
    let x = -0.44
    while (x < 0.10) {
      const th = 0.026 + r() * 0.026
      const h  = 0.17 + r() * 0.07
      const lean = r() < 0.25 ? 0.12 : 0
      const g = chamfer(th, h, 0.16, 0.003, 1).clone()
      if (lean) g.rotateZ(lean)
      g.translate(x + th / 2, 0.022 + h / 2, 0)
      gs.push({ g, mi: Math.floor(r() * PAL.books.length) })
      x += th + 0.005
    }
    return gs
  }, [])

  return (
    <group name="WallShelf" position={position} rotation={rotation}>
      <mesh
        geometry={chamfer(1.10, 0.030, 0.22, 0.006)}
        material={M.oakPanel()}
        castShadow receiveShadow
      />
      {/* shaped brackets */}
      {[-0.42, 0.42].map(x => (
        <group key={x} position={[x, -0.020, -0.012]}>
          <mesh
            geometry={chamfer(0.018, 0.020, 0.185, 0.004)}
            material={M.brassDark()}
            position={[0, -0.006, 0.010]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.018, 0.150, 0.020, 0.004)}
            material={M.brassDark()}
            position={[0, -0.078, -0.075]}
            castShadow
          />
          <mesh
            geometry={chamfer(0.014, 0.150, 0.016, 0.004)}
            material={M.brassDark()}
            position={[0, -0.062, -0.028]}
            rotation={[0.72, 0, 0]}
            castShadow
          />
        </group>
      ))}

      {books.map((b, i) => (
        <mesh key={i} geometry={b.g} material={M.bookSpine(PAL.books[b.mi], b.mi * 7 + 2)} castShadow />
      ))}

      {/* an empty pot on the end */}
      <mesh
        geometry={turned([[0, 0], [0.052, 0], [0.058, 0.012], [0.066, 0.085], [0.070, 0.092], [0.064, 0.096], [0.058, 0.088], [0.048, 0.014], [0, 0.014]], 14)}
        material={M.terracotta()}
        position={[0.38, 0.016, 0]}
        castShadow
      />
    </group>
  )
}
