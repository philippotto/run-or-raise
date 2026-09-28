// Cycling while the shortcut modifiers are held: peek the windows, activate on release.
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { reset, fakeApp, Window } from "./mocks/shell.js"
import { Clutter } from "./mocks/gi.js"
import * as Main from "./mocks/main.js"
import { parseLine } from "../lib/action.js"

const SUPER = Clutter.ModifierType.SUPER_MASK
const NUM_LOCK = Clutter.ModifierType.MOD2_MASK

let app, display, t, ff1, ff2, ff3, a
beforeEach(() => {
  display = reset()
  app = fakeApp()
  ff1 = display.add(firefox())
  ff2 = display.add(firefox())
  ff3 = display.add(firefox())
  t = display.add(new Window({ wm_class: "Gnome-terminal" }), true) // [t, ff1, ff2, ff3]
  a = parseLine("<Super>f,firefox,firefox,", app)
  hold(SUPER)
})

function firefox() {
  return new Window({ wm_class: "firefox" })
}

/** Modifiers held from now on */
function hold(mods) {
  global.get_pointer = () => [0, 0, mods]
}

function grab_actor() {
  assert.equal(Main.modals.length, 1, "grabbed")
  return Main.modals[0].actor
}

function release() {
  hold(0)
  grab_actor().emit("key-release-event", {})
}

function key(symbol) {
  return {
    get_key_symbol: () => symbol,
    get_key_code: () => symbol,
    get_state: () => SUPER,
  }
}

/** Only the peeked window is raised and undimmed */
function assertPeeked(window) {
  const actors = display.window_group.get_children()
  assert.equal(actors.at(-1), window.actor, "raised")
  assert.ok(window.actor.visible)
  for (const actor of actors) {
    assert.equal(
      actor.get_first_child().opacity,
      actor === window.actor ? 255 : 40,
    )
  }
}

/** Nothing peeked, no grab left */
function assertEnded() {
  assert.equal(app.cycle, null)
  assert.equal(Main.modals.length, 0)
  for (const actor of display.window_group.get_children()) {
    assert.equal(actor.get_first_child().opacity, 255)
  }
  for (const actor of Main.layoutManager.chrome) {
    assert.ok(actor.destroyed)
  }
}

test("peek without touching the most recently used order, activate on release", () => {
  const stack = display.window_group.get_children()
  a.trigger()
  assertPeeked(ff1)
  a.trigger()
  assertPeeked(ff2)
  assert.equal(display.focused, t)
  assert.deepEqual(display.windows, [t, ff1, ff2, ff3])
  assert.equal(Main.activated.length, 0)

  // releasing another key does not end it
  grab_actor().emit("key-release-event", {})
  assertPeeked(ff2)

  release()
  assert.deepEqual(Main.activated, [ff2])
  assert.deepEqual(display.windows, [ff2, t, ff1, ff3])
  assertEnded()
  // restored before activation
  assert.deepEqual(display.window_group.get_children(), [
    ...stack.filter(x => x !== ff2.actor),
    ff2.actor,
  ])
})

test("peeking wraps around", () => {
  a.trigger()
  a.trigger()
  a.trigger()
  assertPeeked(ff3)
  a.trigger()
  assertPeeked(ff1)
})

test("start with the window used before the focused one", () => {
  ff1._focus() // [ff1, t, ff2, ff3]
  a.trigger()
  assertPeeked(ff2)
  a.trigger()
  assertPeeked(ff3)
  a.trigger()
  assertPeeked(ff1)
  release()
  assert.equal(display.focused, ff1)
  assert.deepEqual(display.windows, [ff1, t, ff2, ff3])
})

test("Escape cancels", () => {
  const stack = display.window_group.get_children()
  a.trigger()
  a.trigger()
  grab_actor().emit("key-press-event", key("KEY_Escape"))
  assertEnded()
  assert.equal(Main.activated.length, 0)
  assert.equal(display.focused, t)
  assert.deepEqual(display.window_group.get_children(), stack)
})

test("click cancels", () => {
  a.trigger()
  grab_actor().emit("button-press-event", {})
  assertEnded()
  assert.equal(Main.activated.length, 0)
})

test("the lock modifiers do not keep the cycle on", () => {
  hold(NUM_LOCK)
  a.trigger()
  assert.deepEqual(Main.activated, [ff1])
  assertEnded()

  hold(SUPER | NUM_LOCK)
  a.trigger()
  assert.equal(app.cycle.action, a)
  hold(NUM_LOCK)
  grab_actor().emit("key-release-event", {})
  assert.equal(display.focused, ff2)
  assertEnded()
})

test("modifiers released before the grab activate at once", () => {
  let calls = 0
  global.get_pointer = () => [0, 0, calls++ ? 0 : SUPER]
  a.trigger()
  assert.deepEqual(Main.activated, [ff1])
  assertEnded()
})

test("failed grab activates at once", () => {
  Main.grab.state = Clutter.GrabState.POINTER
  a.trigger()
  assert.deepEqual(Main.activated, [ff1])
  assertEnded()
})

test("another shortcut while peeking cancels the cycle", () => {
  a.trigger()
  const b = parseLine("<Super>t,gnome-terminal,Gnome-terminal,", app)
  ff3._focus() // [ff3, t, ff1, ff2]
  b.trigger()
  // t is not focused, the only terminal is peeked
  assert.equal(app.cycle.action, b)
  assertPeeked(t)
  release()
  assert.deepEqual(Main.activated, [t])
})

test("minimized window is shown while peeked", () => {
  ff1.minimize()
  a.trigger()
  assertPeeked(ff1)
  grab_actor().emit("key-press-event", key("KEY_Escape"))
  assert.equal(ff1.actor.visible, false)
})

test("closed windows are skipped", () => {
  a.trigger()
  display.windows = display.windows.filter(w => w !== ff2)
  ff2.actor.destroy()
  a.trigger()
  assertPeeked(ff3)
})

test("peeked window closed", () => {
  a.trigger()
  display.windows = display.windows.filter(w => w !== ff1)
  ff1.actor.destroy()
  release()
  assert.equal(Main.activated.length, 0)
  assertEnded()
})

test("an accelerator reaching the grab is passed on", () => {
  let passed = null
  app.on_accelerator = id => (passed = id)
  display.grab_accelerator("<Super>x")
  a.trigger()
  grab_actor().emit("key-press-event", key("<Super>x"))
  assert.equal(passed, 1)
})

test("single focused window is not cycled", () => {
  display = reset()
  hold(SUPER)
  const ff = display.add(firefox(), true)
  a.trigger()
  assert.equal(app.cycle, null)
  assert.equal(Main.modals.length, 0)
  assert.equal(display.focused, ff)
})

test("the Dash to Panel taskbar icon is highlighted", () => {
  const highlighted = []
  global.dashToPanel = { highlightWindow: w => highlighted.push(w) }
  try {
    a.trigger()
    a.trigger()
    release()
    assert.deepEqual(highlighted, [ff1, ff2, null])
  } finally {
    delete global.dashToPanel
  }
})

test("Dash to Panel without the highlight support", () => {
  global.dashToPanel = {}
  try {
    a.trigger()
    release()
    assert.deepEqual(Main.activated, [ff1])
  } finally {
    delete global.dashToPanel
  }
})
