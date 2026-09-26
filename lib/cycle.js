import * as Main from "resource:///org/gnome/shell/ui/main.js"
import Clutter from "gi://Clutter"
import Shell from "gi://Shell"
import St from "gi://St"

/** Opacity of the other windows while a window is peeked */
const DIM_OPACITY = 40
const ANIMATION_TIME = 150

/**
 * Modifiers whose release ends the cycle.
 * Num_Lock (MOD2) and Caps_Lock (LOCK) are left out, they stay on without being held.
 */
const MODIFIER_MASK =
  Clutter.ModifierType.SHIFT_MASK |
  Clutter.ModifierType.CONTROL_MASK |
  Clutter.ModifierType.MOD1_MASK |
  Clutter.ModifierType.MOD3_MASK |
  Clutter.ModifierType.MOD4_MASK |
  Clutter.ModifierType.MOD5_MASK |
  Clutter.ModifierType.SUPER_MASK |
  Clutter.ModifierType.HYPER_MASK |
  Clutter.ModifierType.META_MASK

/**
 * Cycle through windows the way Alt+Tab does.
 * While the modifiers of the shortcut are held, every step merely peeks the window
 * (raises it and dims the others) without focusing it, so that the most-recently-used
 * order of the windows stays intact. Releasing the modifiers activates the peeked window.
 */
export class Cycle {
  /**
   * @param {Action} action
   * @param {Meta.Window[]} windows Most recently used first
   * @param {number} index The window to go to first
   */
  constructor(action, windows, index) {
    this.action = action
    this.windows = windows
    this.index = index
    this.modifiers = 0
    this.actor = null
    this.grab = null
    /** @type {?{actor, index: number, visible: boolean}} window actor raised by the peek */
    this.peeked = null
    this.dimmed = false
  }

  /**
   * Peek the window until the modifiers are released.
   * If no modifier is held (anymore), activate it right away.
   */
  start() {
    const [, , mods = 0] = global.get_pointer()
    this.modifiers = mods & MODIFIER_MASK
    // the modifiers might have been released before the grab took effect
    if (!this.modifiers || !this._grab() || !this._modifiers_held()) {
      this.finish()
      return
    }
    this.action.app.cycle = this
    this._peek()
  }

  /**
   * The shortcut was hit again while the modifiers are still held.
   */
  next() {
    for (let i = 1; i <= this.windows.length; i++) {
      const index = (this.index + i) % this.windows.length
      if (this.windows[index].get_compositor_private()) {
        // skip windows closed in the meantime
        this.index = index
        break
      }
    }
    this._peek()
  }

  /**
   * Stop cycling and activate the peeked window.
   */
  finish() {
    this._stop()
    // check: the window might have been closed in the meantime
    this.action.focus_window(this.windows[this.index], true)
  }

  /**
   * Stop cycling, keep the originally focused window.
   */
  cancel() {
    this._stop()
  }

  _stop() {
    this._end_peek()
    if (this.grab) {
      Main.popModal(this.grab)
      this.grab = null
    }
    if (this.actor) {
      this.actor.destroy()
      this.actor = null
    }
    if (this.action.app.cycle === this) {
      this.action.app.cycle = null
    }
  }

  /**
   * Grab the keyboard to get notified when the modifiers are released.
   * @return {boolean} Success
   */
  _grab() {
    this.actor = new St.Widget({ reactive: true })
    Main.layoutManager.addChrome(this.actor)
    // the accelerators are allowed in all action modes, they keep working during the grab
    this.grab = Main.pushModal(this.actor, {
      actionMode: Shell.ActionMode.POPUP,
    })
    if (!(this.grab.get_seat_state() & Clutter.GrabState.KEYBOARD)) {
      this._stop()
      return false
    }
    this.actor.connect("key-release-event", () => {
      if (!this._modifiers_held()) {
        this.finish()
      }
      return Clutter.EVENT_STOP
    })
    this.actor.connect("key-press-event", (actor, event) => {
      if (event.get_key_symbol() === Clutter.KEY_Escape) {
        this.cancel()
      } else {
        // Mutter handles the accelerators before the grab would get them.
        // Should it not, pass the key on.
        this.action.app.on_accelerator(
          global.display.get_keybinding_action(
            event.get_key_code(),
            event.get_state(),
          ),
        )
      }
      return Clutter.EVENT_STOP
    })
    this.actor.connect("button-press-event", () => {
      this.cancel()
      return Clutter.EVENT_STOP
    })
    return true
  }

  _modifiers_held() {
    const [, , mods = 0] = global.get_pointer()
    return (mods & this.modifiers) !== 0
  }

  _peek() {
    this._restore_stack()
    const actor = this.windows[this.index].get_compositor_private()
    if (actor) {
      const parent = actor.get_parent()
      this.peeked = {
        actor,
        index: parent.get_children().indexOf(actor),
        visible: actor.visible,
      }
      actor.connectObject("destroy", () => (this.peeked = null), this)
      parent.set_child_above_sibling(actor, null)
      // minimized or on another workspace
      actor.show()
    }
    global
      .get_window_actors()
      .forEach(a => this._fade(a, a === actor ? 255 : DIM_OPACITY))
    this.dimmed = true
  }

  _end_peek() {
    this._restore_stack()
    if (this.dimmed) {
      global.get_window_actors().forEach(a => this._fade(a, 255))
      this.dimmed = false
    }
  }

  /**
   * Put the peeked window back where it was in the stack.
   */
  _restore_stack() {
    if (!this.peeked) {
      return
    }
    const { actor, index, visible } = this.peeked
    this.peeked = null
    actor.disconnectObject(this)
    actor.get_parent().set_child_at_index(actor, index)
    if (!visible) {
      actor.hide()
    }
  }

  _fade(actor, opacity) {
    // Fade the surface rather than the window actor itself, see https://gitlab.gnome.org/GNOME/mutter/issues/836
    // (the same workaround as Dash to Panel's peek)
    const surface = actor.get_first_child() || actor
    surface.ease({
      opacity,
      duration: ANIMATION_TIME,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    })
  }
}
