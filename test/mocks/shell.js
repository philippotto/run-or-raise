// Fake GNOME Shell runtime objects: settings, windows, `global.display`.
import { readFileSync } from "node:fs"
import { Actor, Clutter, Emitter, GLib, Gio, Shell } from "./gi.js"
import * as Main from "./main.js"

const SCHEMA = new URL(
  "../../schemas/org.gnome.shell.extensions.run-or-raise.gschema.xml",
  import.meta.url,
)

/**
 * GSettings of the extension. Known keys are read from the real gschema.
 */
export class Settings {
  constructor(values = {}) {
    const xml = readFileSync(SCHEMA, "utf8")
    this.values = {}
    for (const [, name, def] of xml.matchAll(
      /<key type="b" name="([^"]+)">\s*<default>(\w+)<\/default>/g,
    )) {
      this.values[name] = def === "true"
    }
    Object.assign(this.values, values)
  }

  get_boolean(key) {
    if (!(key in this.values)) {
      throw new Error(`Settings schema does not contain a key named '${key}'`)
    }
    return this.values[key]
  }
}

let next_window_id = 1

export class Window {
  constructor({
    wm_class = "",
    wm_class_instance = "",
    title = "",
    monitor = 0,
    workspace = "ws0",
  } = {}) {
    this.id = next_window_id++
    Object.assign(this, { wm_class, wm_class_instance, title, monitor })
    this.workspace = workspace
    this.minimized = false
    this.actor = new Actor()
    this.actor.add_child(new Actor()) // the surface
  }

  get_id() {
    return this.id
  }
  get_wm_class() {
    return this.wm_class
  }
  get_wm_class_instance() {
    return this.wm_class_instance
  }
  get_title() {
    return this.title
  }
  get_monitor() {
    return this.monitor
  }
  get_workspace() {
    return this.workspace
  }
  get_compositor_private() {
    return this.actor?.destroyed ? null : this.actor
  }
  get_frame_rect() {
    return { x: 100, y: 100, width: 200, height: 100 }
  }
  change_workspace(ws) {
    this.workspace = ws
  }
  has_focus() {
    return display.focused === this
  }
  minimize() {
    this.minimized = true
    this.actor.hide()
  }
  _focus() {
    display.focused = this
    // raise to the top of the stack
    if (this.actor) {
      display.window_group.set_child_above_sibling(this.actor, null)
    }
    // tab list is ordered by the most recent use
    display.windows = [this, ...display.windows.filter(w => w !== this)]
  }
}

class Display extends Emitter {
  constructor() {
    super()
    this.windows = [] // most recently used first
    this.focused = null
    this.grabbed = new Map() // action id → accelerator
    this.window_group = new Actor() // window actors, bottom to top
    this._next_action = 1
  }

  get_workspace_manager() {
    return global.workspaceManager
  }
  get_tab_list(type, workspace) {
    return this.windows.filter(w => !workspace || w.workspace === workspace)
  }
  grab_accelerator(shortcut) {
    const id = this._next_action++
    this.grabbed.set(id, shortcut)
    return id
  }
  ungrab_accelerator(id) {
    if (!this.grabbed.delete(id)) {
      throw new Error(`Accelerator ${id} not grabbed`)
    }
  }

  get_keybinding_action(keycode) {
    // keycodes are the shortcuts themselves in the mock
    return [...this.grabbed].find(([, s]) => s === keycode)?.[0] ?? 0
  }

  /** Add a window, most recently used first */
  add(window, focus = false) {
    this.windows.push(window)
    // stacked below the ones already there
    this.window_group.set_child_at_index(window.actor, 0)
    if (focus) {
      window._focus()
    }
    return window
  }
}

export let display

/**
 * Fresh `global` and clean mock state. Call before each test.
 */
export function reset() {
  display = new Display()
  globalThis.global = globalThis
  global.display = display
  global.workspaceManager = {
    get_active_workspace: () => "ws0",
  }
  global.get_pointer = () => [0, 0, 0]
  global.get_window_actors = () => display.window_group.get_children()
  GLib._reset()
  Gio.Subprocess.spawned.length = 0
  Shell._files.clear()
  Shell.AppSystem._apps.clear()
  Main.activated.length = 0
  Main.notifications.length = 0
  Main.wm.allowed.clear()
  Main.layoutManager.chrome.length = 0
  Main.modals.length = 0
  Main.grab.state = Clutter.GrabState.ALL
  return display
}

/**
 * The part of the App controller an Action needs.
 */
export function fakeApp(settings = new Settings()) {
  return {
    settings,
    register: [],
    cycle: null,
    watching_actions: new Set(),
    seat: {
      warped: [],
      warp_pointer(x, y) {
        this.warped.push([x, y])
      },
    },
    display(text) {
      Main.notify("Run-or-raise", String(text))
    },
  }
}
