/**
 * widget.ts — the small, always-on-top version of the window.
 *
 * Bureau is most useful out of the way: a corner of the screen where you can
 * see Claude working, and see it put a hand up when it needs you, while your
 * real work has the rest of the screen. The full window is for looking closely.
 *
 * The switch is done from the webview rather than from Rust because the
 * webview already knows everything it needs (size, monitor, where it was) and
 * the HUD has to change layout in the same breath anyway.
 */

import {
  getCurrentWindow, currentMonitor, monitorFromPoint,
  LogicalSize, PhysicalSize, PhysicalPosition, UserAttentionType,
} from "@tauri-apps/api/window"
import { useStore } from "../store"
import { wake } from "../anim/activity"

const WIDGET_W = 480
const WIDGET_H = 340
const MARGIN   = 16
const KEY_POS  = "bureau.widget.position"

/** Full-size limits from tauri.conf.json, restored on the way out. */
const FULL_MIN_W = 900
const FULL_MIN_H = 560

export function inTauri(): boolean {
  return typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined"
}

type Saved = { w: number; h: number; x: number; y: number; maximized: boolean }
let saved: Saved | null = null
let busy = false

export async function toggleWidget(): Promise<void> {
  await setWidget(!useStore.getState().widget)
}

export async function setWidget(on: boolean): Promise<void> {
  if (busy || useStore.getState().widget === on) return
  busy = true
  // The layout flips first: in a browser (dev, captures) that is all there is.
  useStore.getState().setWidget(on)
  wake(1200)
  try {
    if (inTauri()) {
      // One retry. The very first switch on a real machine once changed the
      // layout and left the window as it was, with nothing said anywhere; a
      // second attempt is cheap, and silence is not an option.
      try {
        await (on ? enter() : leave())
      } catch {
        await new Promise(r => setTimeout(r, 250))
        await (on ? enter() : leave())
      }
    }
  } catch (e) {
    // A widget layout inside a full-size bordered window is the worst of both:
    // put the layout back, and say what went wrong.
    useStore.getState().setWidget(!on)
    useStore.getState().showToast(`Mode widget indisponible : ${String(e)}`)
    console.error("[bureau] mode widget :", e)
  } finally {
    busy = false
  }
}

/**
 * Started as the widget (`bureau.exe --widget`, from the Claude Code hook or
 * `/desktips`): the shell has already shaped the window before showing it, so
 * only the layout follows — plus the corner the person chose last time.
 */
export async function adoptWidget(): Promise<void> {
  useStore.getState().setWidget(true)
  // Nothing to go back to: leaving opens the ordinary full-size window.
  saved = null
  wake(1200)
  if (!inTauri()) return
  try {
    const p = readPosition()
    if (p && (await monitorFromPoint(p.x + 40, p.y + 20))) {
      await getCurrentWindow().setPosition(new PhysicalPosition(p.x, p.y))
    }
  } catch { /* the default corner is fine */ }
}

async function enter(): Promise<void> {
  const win = getCurrentWindow()

  if (!saved) {
    const size = await win.innerSize()
    const pos  = await win.outerPosition()
    saved = { w: size.width, h: size.height, x: pos.x, y: pos.y, maximized: await win.isMaximized() }
  }
  if (saved.maximized) await win.unmaximize()

  await win.setDecorations(false)
  await win.setMinSize(new LogicalSize(320, 220))
  await win.setSize(new LogicalSize(WIDGET_W, WIDGET_H))

  // Where the widget was last time, if that still lands on a screen (a
  // monitor unplugged since would put it out of reach); otherwise the
  // bottom-right corner of this one, clear of the taskbar.
  let remembered = readPosition()
  if (remembered && !(await monitorFromPoint(remembered.x + 40, remembered.y + 20))) remembered = null
  if (remembered) {
    await win.setPosition(new PhysicalPosition(remembered.x, remembered.y))
  } else {
    const mon = await currentMonitor()
    if (mon) {
      const area = mon.workArea ?? { position: mon.position, size: mon.size }
      const sf = mon.scaleFactor
      const x = area.position.x + area.size.width  - Math.round((WIDGET_W + MARGIN) * sf)
      const y = area.position.y + area.size.height - Math.round((WIDGET_H + MARGIN) * sf)
      await win.setPosition(new PhysicalPosition(x, y))
    }
  }
  await win.setAlwaysOnTop(true)
}

async function leave(): Promise<void> {
  const win = getCurrentWindow()

  // Remember where the person put it, so it comes back to the same corner.
  try {
    const p = await win.outerPosition()
    localStorage.setItem(KEY_POS, JSON.stringify({ x: p.x, y: p.y }))
  } catch { /* storage can be unavailable; the default corner is fine */ }

  await win.setAlwaysOnTop(false)
  await win.setDecorations(true)
  await win.setMinSize(new LogicalSize(FULL_MIN_W, FULL_MIN_H))
  if (saved) {
    await win.setSize(new PhysicalSize(saved.w, saved.h))
    await win.setPosition(new PhysicalPosition(saved.x, saved.y))
    if (saved.maximized) await win.maximize()
  } else {
    await win.setSize(new LogicalSize(1280, 800))
    await win.center()
  }
  saved = null
}

function readPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(KEY_POS)
    if (!raw) return null
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
    return typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null
  } catch {
    return null
  }
}

/** Flash the taskbar button when Claude needs the person and the window is
 *  not in front. Windows keeps it lit until the window is focused. */
export async function askForAttention(): Promise<void> {
  if (!inTauri()) return
  try {
    const win = getCurrentWindow()
    if (await win.isFocused()) return
    await win.requestUserAttention(UserAttentionType.Informational)
  } catch { /* a missing permission must not break the room */ }
}
