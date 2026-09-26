// Minimal stand-ins for the GObject introspection libraries used by the extension.

/**
 * GObject-like signal emitter, including the GNOME Shell `connectObject()` extension.
 */
export class Emitter {
  constructor() {
    this._handlers = new Map() // id → {signal, fn, tracker}
    this._next_id = 1
  }

  connect(signal, fn) {
    const id = this._next_id++
    this._handlers.set(id, { signal, fn, tracker: null })
    return id
  }

  connect_after(signal, fn) {
    return this.connect(signal, fn)
  }

  disconnect(id) {
    if (!this._handlers.delete(id)) {
      throw new Error(`No signal handler with id ${id} found`)
    }
  }

  /** connectObject(signal, fn, [signal, fn, …], tracker) */
  connectObject(...args) {
    const tracker = args.pop()
    for (let i = 0; i < args.length; i += 2) {
      const id = this.connect(args[i], args[i + 1])
      this._handlers.get(id).tracker = tracker
    }
  }

  disconnectObject(tracker) {
    for (const [id, h] of this._handlers) {
      if (h.tracker === tracker) {
        this._handlers.delete(id)
      }
    }
  }

  emit(signal, ...args) {
    for (const h of [...this._handlers.values()]) {
      if (h.signal === signal) {
        h.fn(this, ...args)
      }
    }
  }

  handler_count(signal = null) {
    return [...this._handlers.values()].filter(
      h => signal === null || h.signal === signal,
    ).length
  }
}

/**
 * Fake main loop: sources run only when a test fires them.
 */
export const GLib = {
  PRIORITY_DEFAULT: 0,
  SOURCE_REMOVE: false,
  SOURCE_CONTINUE: true,
  _sources: new Map(), // id → {fn, ms}
  _next_id: 1,

  timeout_add(priority, ms, fn) {
    const id = this._next_id++
    this._sources.set(id, { fn, ms })
    return id
  },
  timeout_add_seconds(priority, s, fn) {
    return this.timeout_add(priority, s * 1000, fn)
  },
  source_remove(id) {
    // the real GLib logs a CRITICAL when removing a source that is already gone
    if (!this._sources.delete(id)) {
      throw new Error(
        `Source ID ${id} was not found when attempting to remove it`,
      )
    }
  },
  shell_parse_argv(command) {
    return [true, command.split(" ")]
  },

  // --- test helpers ---
  /** Run a single pending source (as the main loop would) */
  _fire(id) {
    const source = this._sources.get(id)
    if (!source) {
      throw new Error(`Source ${id} not pending`)
    }
    if (source.fn() !== true) {
      this._sources.delete(id)
    }
  },
  /** Run every source with the given interval that is pending right now */
  _fire_all(ms) {
    for (const [id, s] of [...this._sources]) {
      if (s.ms === ms && this._sources.has(id)) {
        this._fire(id)
      }
    }
  },
  _pending(ms = null) {
    return [...this._sources.values()].filter(s => ms === null || s.ms === ms)
      .length
  },
  _reset() {
    this._sources.clear()
  },
}

export const Gio = {
  SubprocessFlags: { NONE: 0 },
  Subprocess: {
    spawned: [],
    new(argv) {
      this.spawned.push(argv)
      return {}
    },
  },
  File: {
    new_for_path(path) {
      return {
        path,
        make_directory_with_parents() {},
        copy() {},
      }
    },
  },
  DBus: { session: {} },
  DBusExportedObject: {
    wrapJSObject() {
      return { export() {}, unexport() {}, flush() {} }
    },
  },
}

export const Shell = {
  ActionMode: { NONE: 0, ALL: 1, POPUP: 2 },
  /** path → file contents, see get_file_contents_utf8_sync */
  _files: new Map(),
  get_file_contents_utf8_sync(path) {
    if (!this._files.has(path)) {
      throw new Error(`No such file ${path}`)
    }
    return this._files.get(path)
  },
  AppSystem: {
    /** command → app mock, see lookup_app */
    _apps: new Map(),
    get_default() {
      return this
    },
    lookup_app(command) {
      return this._apps.get(command) ?? null
    },
  },
}

export const Mtk = {
  Rectangle: class {
    constructor({ x, y, width, height }) {
      Object.assign(this, { x, y, width, height })
    }
    intersect(r) {
      const hit =
        this.x < r.x + r.width &&
        r.x < this.x + this.width &&
        this.y < r.y + r.height &&
        r.y < this.y + this.height
      return [hit]
    }
  },
}

export const Meta = {
  KeyBindingAction: { NONE: 0 },
  external_binding_name_for_action(id) {
    return `external-grab-${id}`
  },
}

/**
 * Clutter.Actor stand-in, enough for the window actors and the grab actor.
 * Transitions complete at once.
 */
export class Actor extends Emitter {
  constructor(props = {}) {
    super()
    this.visible = true
    this.opacity = 255
    this.parent = null
    this.children = []
    this.destroyed = false
    Object.assign(this, props)
  }
  get_parent() {
    return this.parent
  }
  get_children() {
    return [...this.children]
  }
  get_first_child() {
    return this.children[0] ?? null
  }
  add_child(child) {
    child.parent = this
    this.children.push(child)
  }
  remove_child(child) {
    this.children = this.children.filter(c => c !== child)
    child.parent = null
  }
  set_child_above_sibling(child, sibling) {
    // only the `sibling = null` (to the top) case is needed
    this.remove_child(child)
    this.add_child(child)
  }
  set_child_at_index(child, index) {
    this.remove_child(child)
    child.parent = this
    this.children.splice(index, 0, child)
  }
  show() {
    this.visible = true
  }
  hide() {
    this.visible = false
  }
  ease({ opacity }) {
    this.opacity = opacity
  }
  destroy() {
    this.destroyed = true
    this.parent?.remove_child(this)
    this.emit("destroy")
  }
}

export const St = {
  Widget: class extends Actor {
    grab_key_focus() {}
  },
  Bin: class extends Emitter {
    constructor(props) {
      super()
      Object.assign(this, props)
    }
    set_position() {}
    grab_key_focus() {}
    destroy() {
      this.destroyed = true
    }
  },
}

export const Clutter = new Proxy(
  {
    EVENT_STOP: true,
    EVENT_PROPAGATE: false,
    ModifierType: {
      SHIFT_MASK: 1 << 0,
      LOCK_MASK: 1 << 1,
      CONTROL_MASK: 1 << 2,
      MOD1_MASK: 1 << 3,
      MOD2_MASK: 1 << 4,
      MOD3_MASK: 1 << 5,
      MOD4_MASK: 1 << 6,
      MOD5_MASK: 1 << 7,
      SUPER_MASK: 1 << 26,
      HYPER_MASK: 1 << 27,
      META_MASK: 1 << 28,
    },
    GrabState: { NONE: 0, POINTER: 1, KEYBOARD: 2, ALL: 3 },
    AnimationMode: { EASE_OUT_QUAD: 2 },
    get_default_backend() {
      return {
        get_default_seat() {
          return {
            warped: [],
            get_keymap() {
              return new Keymap()
            },
            warp_pointer(x, y) {
              this.warped.push([x, y])
            },
          }
        },
      }
    },
  },
  {
    // every Clutter.KEY_* constant exists
    get: (target, prop) =>
      prop in target
        ? target[prop]
        : typeof prop === "string" && prop.startsWith("KEY_")
          ? prop
          : undefined,
  },
)

export class Keymap extends Emitter {
  constructor() {
    super()
    this.num_lock = false
    this.caps_lock = false
  }
  get_num_lock_state() {
    return this.num_lock
  }
  get_caps_lock_state() {
    return this.caps_lock
  }
}
