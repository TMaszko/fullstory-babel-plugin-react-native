/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

'use strict';

import { isHoverEnabled } from './HoverState';
import invariant from 'invariant';
import SoundManager from '../Components/Sound/SoundManager';
import { normalizeRect, type RectOrSize } from '../StyleSheet/Rect';
import type { BlurEvent, FocusEvent, PressEvent, MouseEvent } from '../Types/CoreEventTypes';
import Platform from '../Utilities/Platform';
import UIManager from '../ReactNative/UIManager';
import type { HostComponent } from '../Renderer/shims/ReactNativeTypes';
import * as React from 'react';

export type PressabilityConfig = $ReadOnly<{|
  /**
   * Whether a press gesture can be interrupted by a parent gesture such as a
   * scroll event. Defaults to true.
   */
  cancelable?: ?boolean

  /**
   * Whether to disable initialization of the press gesture.
   */
  ; disabled?: ?boolean

  /**
   * Amount to extend the `VisualRect` by to create `HitRect`.
   */
  ; hitSlop?: ?RectOrSize

  /**
   * Amount to extend the `HitRect` by to create `PressRect`.
   */
  ; pressRectOffset?: ?RectOrSize

  /**
   * Whether to disable the systemm sound when `onPress` fires on Android.
   **/
  ; android_disableSound?: ?boolean

  /**
   * Duration to wait after hover in before calling `onHoverIn`.
   */
  ; delayHoverIn?: ?number

  /**
   * Duration to wait after hover out before calling `onHoverOut`.
   */
  ; delayHoverOut?: ?number

  /**
   * Duration (in addition to `delayPressIn`) after which a press gesture is
   * considered a long press gesture. Defaults to 500 (milliseconds).
   */
  ; delayLongPress?: ?number

  /**
   * Duration to wait after press down before calling `onPressIn`.
   */
  ; delayPressIn?: ?number

  /**
   * Duration to wait after letting up before calling `onPressOut`.
   */
  ; delayPressOut?: ?number

  /**
   * Called after the element loses focus.
   */
  ; onBlur?: ?(event: BlurEvent) => mixed

  /**
   * Called after the element is focused.
   */
  ; onFocus?: ?(event: FocusEvent) => mixed

  /**
   * Called when the hover is activated to provide visual feedback.
   */
  ; onHoverIn?: ?(event: MouseEvent) => mixed

  /**
   * Called when the hover is deactivated to undo visual feedback.
   */
  ; onHoverOut?: ?(event: MouseEvent) => mixed

  /**
   * Called when a long press gesture has been triggered.
   */
  ; onLongPress?: ?(event: PressEvent) => mixed

  /**
   * Called when a press gestute has been triggered.
   */
  ; onPress?: ?(event: PressEvent) => mixed

  /**
   * Called when the press is activated to provide visual feedback.
   */
  ; onPressIn?: ?(event: PressEvent) => mixed

  /**
   * Called when the press location moves. (This should rarely be used.)
   */
  ; onPressMove?: ?(event: PressEvent) => mixed

  /**
   * Called when the press is deactivated to undo visual feedback.
   */
  ; onPressOut?: ?(event: PressEvent) => mixed

  /**
   * Returns whether a long press gesture should cancel the press gesture.
   * Defaults to true.
   */
  ; onLongPressShouldCancelPress_DEPRECATED?: ?() => boolean

  /**
   * If `cancelable` is set, this will be ignored.
   *
   * Returns whether to yield to a lock termination request (e.g. if a native
   * scroll gesture attempts to steal the responder lock).
   */
  ; onResponderTerminationRequest_DEPRECATED?: ?() => boolean

  /**
   * If `disabled` is set, this will be ignored.
   *
   * Returns whether to start a press gesture.
   *
   * @deprecated
   */
  ; onStartShouldSetResponder_DEPRECATED?: ?() => boolean;
|}>;

export type EventHandlers = $ReadOnly<{|
  onBlur: (event: BlurEvent) => void;
  onClick: (event: PressEvent) => void;
  onFocus: (event: FocusEvent) => void;
  onMouseEnter?: (event: MouseEvent) => void;
  onMouseLeave?: (event: MouseEvent) => void;
  onResponderGrant: (event: PressEvent) => void;
  onResponderMove: (event: PressEvent) => void;
  onResponderRelease: (event: PressEvent) => void;
  onResponderTerminate: (event: PressEvent) => void;
  onResponderTerminationRequest: () => boolean;
  onStartShouldSetResponder: () => boolean;
|}>;

type TouchState = 'NOT_RESPONDER' | 'RESPONDER_INACTIVE_PRESS_IN' | 'RESPONDER_INACTIVE_PRESS_OUT' | 'RESPONDER_ACTIVE_PRESS_IN' | 'RESPONDER_ACTIVE_PRESS_OUT' | 'RESPONDER_ACTIVE_LONG_PRESS_IN' | 'RESPONDER_ACTIVE_LONG_PRESS_OUT' | 'ERROR';

type TouchSignal = 'DELAY' | 'RESPONDER_GRANT' | 'RESPONDER_RELEASE' | 'RESPONDER_TERMINATED' | 'ENTER_PRESS_RECT' | 'LEAVE_PRESS_RECT' | 'LONG_PRESS_DETECTED';

const Transitions = Object.freeze({
  NOT_RESPONDER: {
    DELAY: 'ERROR',
    RESPONDER_GRANT: 'RESPONDER_INACTIVE_PRESS_IN',
    RESPONDER_RELEASE: 'ERROR',
    RESPONDER_TERMINATED: 'ERROR',
    ENTER_PRESS_RECT: 'ERROR',
    LEAVE_PRESS_RECT: 'ERROR',
    LONG_PRESS_DETECTED: 'ERROR'
  },
  RESPONDER_INACTIVE_PRESS_IN: {
    DELAY: 'RESPONDER_ACTIVE_PRESS_IN',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_INACTIVE_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_INACTIVE_PRESS_OUT',
    LONG_PRESS_DETECTED: 'ERROR'
  },
  RESPONDER_INACTIVE_PRESS_OUT: {
    DELAY: 'RESPONDER_ACTIVE_PRESS_OUT',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_INACTIVE_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_INACTIVE_PRESS_OUT',
    LONG_PRESS_DETECTED: 'ERROR'
  },
  RESPONDER_ACTIVE_PRESS_IN: {
    DELAY: 'ERROR',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_ACTIVE_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_ACTIVE_PRESS_OUT',
    LONG_PRESS_DETECTED: 'RESPONDER_ACTIVE_LONG_PRESS_IN'
  },
  RESPONDER_ACTIVE_PRESS_OUT: {
    DELAY: 'ERROR',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_ACTIVE_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_ACTIVE_PRESS_OUT',
    LONG_PRESS_DETECTED: 'ERROR'
  },
  RESPONDER_ACTIVE_LONG_PRESS_IN: {
    DELAY: 'ERROR',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_ACTIVE_LONG_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_ACTIVE_LONG_PRESS_OUT',
    LONG_PRESS_DETECTED: 'RESPONDER_ACTIVE_LONG_PRESS_IN'
  },
  RESPONDER_ACTIVE_LONG_PRESS_OUT: {
    DELAY: 'ERROR',
    RESPONDER_GRANT: 'ERROR',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'RESPONDER_ACTIVE_LONG_PRESS_IN',
    LEAVE_PRESS_RECT: 'RESPONDER_ACTIVE_LONG_PRESS_OUT',
    LONG_PRESS_DETECTED: 'ERROR'
  },
  ERROR: {
    DELAY: 'NOT_RESPONDER',
    RESPONDER_GRANT: 'RESPONDER_INACTIVE_PRESS_IN',
    RESPONDER_RELEASE: 'NOT_RESPONDER',
    RESPONDER_TERMINATED: 'NOT_RESPONDER',
    ENTER_PRESS_RECT: 'NOT_RESPONDER',
    LEAVE_PRESS_RECT: 'NOT_RESPONDER',
    LONG_PRESS_DETECTED: 'NOT_RESPONDER'
  }
});

const isActiveSignal = signal => signal === 'RESPONDER_ACTIVE_PRESS_IN' || signal === 'RESPONDER_ACTIVE_LONG_PRESS_IN';

const isActivationSignal = signal => signal === 'RESPONDER_ACTIVE_PRESS_OUT' || signal === 'RESPONDER_ACTIVE_PRESS_IN';

const isPressInSignal = signal => signal === 'RESPONDER_INACTIVE_PRESS_IN' || signal === 'RESPONDER_ACTIVE_PRESS_IN' || signal === 'RESPONDER_ACTIVE_LONG_PRESS_IN';

const isTerminalSignal = signal => signal === 'RESPONDER_TERMINATED' || signal === 'RESPONDER_RELEASE';

const DEFAULT_LONG_PRESS_DELAY_MS = 370; // 500 - 130
const DEFAULT_PRESS_DELAY_MS = 130;
const DEFAULT_PRESS_RECT_OFFSETS = {
  bottom: 30,
  left: 20,
  right: 20,
  top: 20
};

/**
 * Pressability implements press handling capabilities.
 *
 * =========================== Pressability Tutorial ===========================
 *
 * The `Pressability` class helps you create press interactions by analyzing the
 * geometry of elements and observing when another responder (e.g. ScrollView)
 * has stolen the touch lock. It offers hooks for your component to provide
 * interaction feedback to the user:
 *
 * - When a press has activated (e.g. highlight an element)
 * - When a press has deactivated (e.g. un-highlight an element)
 * - When a press sould trigger an action, meaning it activated and deactivated
 *   while within the geometry of the element without the lock being stolen.
 *
 * A high quality interaction isn't as simple as you might think. There should
 * be a slight delay before activation. Moving your finger beyond an element's
 * bounds should trigger deactivation, but moving the same finger back within an
 * element's bounds should trigger reactivation.
 *
 * In order to use `Pressability`, do the following:
 *
 * 1. Instantiate `Pressability` and store it on your component's state.
 *
 *    state = {
 *      pressability: new Pressability({
 *        // ...
 *      }),
 *    };
 *
 * 2. Choose the rendered component who should collect the press events. On that
 *    element, spread `pressability.getEventHandlers()` into its props.
 *
 *    return (
 *      <View {...this.state.pressability.getEventHandlers()} />
 *    );
 *
 * 3. Reset `Pressability` when your component unmounts.
 *
 *    componentWillUnmount() {
 *      this.state.pressability.reset();
 *    }
 *
 * ==================== Pressability Implementation Details ====================
 *
 * `Pressability` only assumes that there exists a `HitRect` node. The `PressRect`
 * is an abstract box that is extended beyond the `HitRect`.
 *
 * # Geometry
 *
 *  ┌────────────────────────┐
 *  │  ┌──────────────────┐  │ - Presses start anywhere within `HitRect`, which
 *  │  │  ┌────────────┐  │  │   is expanded via the prop `hitSlop`.
 *  │  │  │ VisualRect │  │  │
 *  │  │  └────────────┘  │  │ - When pressed down for sufficient amount of time
 *  │  │    HitRect       │  │   before letting up, `VisualRect` activates for
 *  │  └──────────────────┘  │   as long as the press stays within `PressRect`.
 *  │       PressRect    o   │
 *  └────────────────────│───┘
 *          Out Region   └────── `PressRect`, which is expanded via the prop
 *                               `pressRectOffset`, allows presses to move
 *                               beyond `HitRect` while maintaining activation
 *                               and being eligible for a "press".
 *
 * # State Machine
 *
 * ┌───────────────┐ ◀──── RESPONDER_RELEASE
 * │ NOT_RESPONDER │
 * └───┬───────────┘ ◀──── RESPONDER_TERMINATED
 *     │
 *     │ RESPONDER_GRANT (HitRect)
 *     │
 *     ▼
 * ┌─────────────────────┐          ┌───────────────────┐              ┌───────────────────┐
 * │ RESPONDER_INACTIVE_ │  DELAY   │ RESPONDER_ACTIVE_ │  T + DELAY   │ RESPONDER_ACTIVE_ │
 * │ PRESS_IN            ├────────▶ │ PRESS_IN          ├────────────▶ │ LONG_PRESS_IN     │
 * └─┬───────────────────┘          └─┬─────────────────┘              └─┬─────────────────┘
 *   │           ▲                    │           ▲                      │           ▲
 *   │LEAVE_     │                    │LEAVE_     │                      │LEAVE_     │
 *   │PRESS_RECT │ENTER_              │PRESS_RECT │ENTER_                │PRESS_RECT │ENTER_
 *   │           │PRESS_RECT          │           │PRESS_RECT            │           │PRESS_RECT
 *   ▼           │                    ▼           │                      ▼           │
 * ┌─────────────┴───────┐          ┌─────────────┴─────┐              ┌─────────────┴─────┐
 * │ RESPONDER_INACTIVE_ │  DELAY   │ RESPONDER_ACTIVE_ │              │ RESPONDER_ACTIVE_ │
 * │ PRESS_OUT           ├────────▶ │ PRESS_OUT         │              │ LONG_PRESS_OUT    │
 * └─────────────────────┘          └───────────────────┘              └───────────────────┘
 *
 * T + DELAY => LONG_PRESS_DELAY + DELAY
 *
 * Not drawn are the side effects of each transition. The most important side
 * effect is the invocation of `onPress` and `onLongPress` that occur when a
 * responder is release while in the "press in" states.
 */
export default class Pressability {
  _config: PressabilityConfig;
  _eventHandlers: ?EventHandlers;
  _hoverInDelayTimeout: ?TimeoutID;
  _hoverOutDelayTimeout: ?TimeoutID;
  _isHovered: boolean;
  _longPressDelayTimeout: ?TimeoutID;
  _pressDelayTimeout: ?TimeoutID;
  _pressOutDelayTimeout: ?TimeoutID;
  _responderID: ?number | React.ElementRef<HostComponent<mixed>>;
  _responderRegion: ?$ReadOnly<{|
    bottom: number;
    left: number;
    right: number;
    top: number;
  |}>;
  _touchActivatePosition: ?$ReadOnly<{|
    pageX: number;
    pageY: number;
  |}>;
  _touchState: TouchState;

  constructor(config: PressabilityConfig) {
    this.configure(config);
  }

  configure(config: PressabilityConfig): void {
    this._config = config;
  }

  /**
   * Resets any pending timers. This should be called on unmount.
   */
  reset(): void {
    this._cancelHoverInDelayTimeout();
    this._cancelHoverOutDelayTimeout();
    this._cancelLongPressDelayTimeout();
    this._cancelPressDelayTimeout();
    this._cancelPressOutDelayTimeout();
  }

  /**
   * Returns a set of props to spread into the interactive element.
   */
  getEventHandlers(): EventHandlers {
    if (this._eventHandlers == null) {
      this._eventHandlers = this._createEventHandlers();
    }
    return this._eventHandlers;
  }

  _createEventHandlers(): EventHandlers {
    const focusEventHandlers = {
      onBlur: (event: BlurEvent): void => {
        const { onBlur } = this._config;
        if (onBlur != null) {
          onBlur(event);
        }
      },
      onFocus: (event: FocusEvent): void => {
        const { onFocus } = this._config;
        if (onFocus != null) {
          onFocus(event);
        }
      }
    };

    const responderEventHandlers = {
      onStartShouldSetResponder: (): boolean => {
        const { disabled } = this._config;
        if (disabled == null) {
          const { onStartShouldSetResponder_DEPRECATED } = this._config;
          return onStartShouldSetResponder_DEPRECATED == null ? true : onStartShouldSetResponder_DEPRECATED();
        }
        return !disabled;
      },

      onResponderGrant: (event: PressEvent): void => {
        event.persist();

        this._cancelPressOutDelayTimeout();

        this._responderID = event.currentTarget;
        this._touchState = 'NOT_RESPONDER';
        this._receiveSignal('RESPONDER_GRANT', event);

        const delayPressIn = normalizeDelay(this._config.delayPressIn, 0, DEFAULT_PRESS_DELAY_MS);

        if (delayPressIn > 0) {
          this._pressDelayTimeout = setTimeout(() => {
            this._receiveSignal('DELAY', event);
          }, delayPressIn);
        } else {
          this._receiveSignal('DELAY', event);
        }

        const delayLongPress = normalizeDelay(this._config.delayLongPress, 10, DEFAULT_LONG_PRESS_DELAY_MS);
        this._longPressDelayTimeout = setTimeout(() => {
          this._handleLongPress(event);
        }, delayLongPress + delayPressIn);
      },

      onResponderMove: (event: PressEvent): void => {
        if (this._config.onPressMove != null) {
          this._config.onPressMove(event);
        }

        // Region may not have finished being measured, yet.
        const responderRegion = this._responderRegion;
        if (responderRegion == null) {
          return;
        }

        const touch = getTouchFromPressEvent(event);
        if (touch == null) {
          this._cancelLongPressDelayTimeout();
          this._receiveSignal('LEAVE_PRESS_RECT', event);
          return;
        }

        if (this._touchActivatePosition != null) {
          const deltaX = this._touchActivatePosition.pageX - touch.pageX;
          const deltaY = this._touchActivatePosition.pageY - touch.pageY;
          if (Math.hypot(deltaX, deltaY) > 10) {
            this._cancelLongPressDelayTimeout();
          }
        }

        if (this._isTouchWithinResponderRegion(touch, responderRegion)) {
          this._receiveSignal('ENTER_PRESS_RECT', event);
        } else {
          this._cancelLongPressDelayTimeout();
          this._receiveSignal('LEAVE_PRESS_RECT', event);
        }
      },

      onResponderRelease: (event: PressEvent): void => {
        this._receiveSignal('RESPONDER_RELEASE', event);
      },

      onResponderTerminate: (event: PressEvent): void => {
        this._receiveSignal('RESPONDER_TERMINATED', event);
      },

      onResponderTerminationRequest: (): boolean => {
        const { cancelable } = this._config;
        if (cancelable == null) {
          const { onResponderTerminationRequest_DEPRECATED } = this._config;
          return onResponderTerminationRequest_DEPRECATED == null ? true : onResponderTerminationRequest_DEPRECATED();
        }
        return cancelable;
      },

      onClick: (event: PressEvent): void => {
        const { onPress } = this._config;
        if (onPress != null) {
          onPress(event);
        }
      }
    };

    if (process.env.NODE_ENV === 'test') {
      // We are setting this in order to find this node in ReactNativeTestTools
      responderEventHandlers.onStartShouldSetResponder.testOnly_pressabilityConfig = () => this._config;
    }

    const mouseEventHandlers = Platform.OS === 'ios' || Platform.OS === 'android' ? null : {
      onMouseEnter: (event: MouseEvent): void => {
        if (isHoverEnabled()) {
          this._isHovered = true;
          this._cancelHoverOutDelayTimeout();
          const { onHoverIn } = this._config;
          if (onHoverIn != null) {
            const delayHoverIn = normalizeDelay(this._config.delayHoverIn);
            if (delayHoverIn > 0) {
              this._hoverInDelayTimeout = setTimeout(() => {
                onHoverIn(event);
              }, delayHoverIn);
            } else {
              onHoverIn(event);
            }
          }
        }
      },

      onMouseLeave: (event: MouseEvent): void => {
        if (this._isHovered) {
          this._isHovered = false;
          this._cancelHoverInDelayTimeout();
          const { onHoverOut } = this._config;
          if (onHoverOut != null) {
            const delayHoverOut = normalizeDelay(this._config.delayHoverOut);
            if (delayHoverOut > 0) {
              this._hoverInDelayTimeout = setTimeout(() => {
                onHoverOut(event);
              }, delayHoverOut);
            } else {
              onHoverOut(event);
            }
          }
        }
      }
    };

    return {
      focusEventHandlers,
      responderEventHandlers,
      mouseEventHandlers
    };
  }

  /**
   * Receives a state machine signal, performs side effects of the transition
   * and stores the new state. Validates the transition as well.
   */
  _receiveSignal(signal: TouchSignal, event: PressEvent): void {
    const prevState = this._touchState;
    const nextState = Transitions[prevState][signal];
    if (this._responderID == null && signal === 'RESPONDER_RELEASE') {
      return;
    }
    invariant(nextState != null && nextState !== 'ERROR', 'Pressability: Invalid signal `%s` for state `%s` on responder: %s', signal, prevState, typeof this._responderID === 'number' ? this._responderID : '<<host component>>');
    if (prevState !== nextState) {
      this._performTransitionSideEffects(prevState, nextState, signal, event);
      this._touchState = nextState;
    }
  }

  /**
   * Performs a transition between touchable states and identify any activations
   * or deactivations (and callback invocations).
   */
  _performTransitionSideEffects(prevState: TouchState, nextState: TouchState, signal: TouchSignal, event: PressEvent): void {
    if (isTerminalSignal(signal)) {
      this._touchActivatePosition = null;
      this._cancelLongPressDelayTimeout();
    }

    const isInitialTransition = prevState === 'NOT_RESPONDER' && nextState === 'RESPONDER_INACTIVE_PRESS_IN';

    const isActivationTransiton = !isActivationSignal(prevState) && isActivationSignal(nextState);

    if (isInitialTransition || isActivationTransiton) {
      this._measureResponderRegion();
    }

    if (isPressInSignal(prevState) && signal === 'LONG_PRESS_DETECTED') {
      const { onLongPress } = this._config;
      if (onLongPress != null) {
        onLongPress(event);

        this._onFsPressForward_Pressability(true);
      }
    }

    const isPrevActive = isActiveSignal(prevState);
    const isNextActive = isActiveSignal(nextState);

    if (!isPrevActive && isNextActive) {
      this._activate(event);
    } else if (isPrevActive && !isNextActive) {
      this._deactivate(event);
    }

    if (isPressInSignal(prevState) && signal === 'RESPONDER_RELEASE') {
      const { onLongPress, onPress, android_disableSound } = this._config;
      if (onPress != null) {
        const isPressCanceledByLongPress = onLongPress != null && prevState === 'RESPONDER_ACTIVE_LONG_PRESS_IN' && this._shouldLongPressCancelPress();
        if (!isPressCanceledByLongPress) {
          // If we never activated (due to delays), activate and deactivate now.
          if (!isNextActive && !isPrevActive) {
            this._activate(event);
            this._deactivate(event);
          }
          if (Platform.OS === 'android' && android_disableSound !== true) {
            SoundManager.playTouchSound();
          }
          onPress(event);

          this._onFsPressForward_Pressability(false);
        }
      }
    }

    this._cancelPressDelayTimeout();
  }

  _activate(event: PressEvent): void {
    const { onPressIn } = this._config;
    const touch = getTouchFromPressEvent(event);
    this._touchActivatePosition = {
      pageX: touch.pageX,
      pageY: touch.pageY
    };
    if (onPressIn != null) {
      onPressIn(event);
    }
  }

  _deactivate(event: PressEvent): void {
    const { onPressOut } = this._config;
    if (onPressOut != null) {
      const delayPressOut = normalizeDelay(this._config.delayPressOut);
      if (delayPressOut > 0) {
        this._pressOutDelayTimeout = setTimeout(() => {
          onPressOut(event);
        }, delayPressOut);
      } else {
        onPressOut(event);
      }
    }
  }

  _measureResponderRegion(): void {
    if (this._responderID == null) {
      return;
    }

    if (typeof this._responderID === 'number') {
      UIManager.measure(this._responderID, this._measureCallback);
    } else {
      this._responderID.measure(this._measureCallback);
    }
  }

  _measureCallback(left, top, width, height, pageX, pageY): void {
    if (!left && !top && !width && !height && !pageX && !pageY) {
      return;
    }
    this._responderRegion = {
      bottom: pageY + height,
      left: pageX,
      right: pageX + width,
      top: pageY
    };
  }

  _isTouchWithinResponderRegion(touch: $PropertyType<PressEvent, 'nativeEvent'>, responderRegion: $ReadOnly<{|
    bottom: number;
    left: number;
    right: number;
    top: number;
  |}>): boolean {
    const hitSlop = normalizeRect(this._config.hitSlop);
    const pressRectOffset = normalizeRect(this._config.pressRectOffset);

    let regionBottom = responderRegion.bottom;
    let regionLeft = responderRegion.left;
    let regionRight = responderRegion.right;
    let regionTop = responderRegion.top;

    if (hitSlop != null) {
      if (hitSlop.bottom != null) {
        regionBottom += hitSlop.bottom;
      }
      if (hitSlop.left != null) {
        regionLeft -= hitSlop.left;
      }
      if (hitSlop.right != null) {
        regionRight += hitSlop.right;
      }
      if (hitSlop.top != null) {
        regionTop -= hitSlop.top;
      }
    }

    regionBottom += pressRectOffset.bottom;
    regionLeft -= pressRectOffset.left;
    regionRight += pressRectOffset.right;
    regionTop -= pressRectOffset.top;

    return touch.pageX > regionLeft && touch.pageX < regionRight && touch.pageY > regionTop && touch.pageY < regionBottom;
  }

  _handleLongPress(event: PressEvent): void {
    if (this._touchState === 'RESPONDER_ACTIVE_PRESS_IN' || this._touchState === 'RESPONDER_ACTIVE_LONG_PRESS_IN') {
      this._receiveSignal('LONG_PRESS_DETECTED', event);
    }
  }

  _shouldLongPressCancelPress(): boolean {
    return this._config.onLongPressShouldCancelPress_DEPRECATED == null || this._config.onLongPressShouldCancelPress_DEPRECATED();
  }

  _cancelHoverInDelayTimeout(): void {
    if (this._hoverInDelayTimeout != null) {
      clearTimeout(this._hoverInDelayTimeout);
      this._hoverInDelayTimeout = null;
    }
  }

  _cancelHoverOutDelayTimeout(): void {
    if (this._hoverOutDelayTimeout != null) {
      clearTimeout(this._hoverOutDelayTimeout);
      this._hoverOutDelayTimeout = null;
    }
  }

  _cancelLongPressDelayTimeout(): void {
    if (this._longPressDelayTimeout != null) {
      clearTimeout(this._longPressDelayTimeout);
      this._longPressDelayTimeout = null;
    }
  }

  _cancelPressDelayTimeout(): void {
    if (this._pressDelayTimeout != null) {
      clearTimeout(this._pressDelayTimeout);
      this._pressDelayTimeout = null;
    }
  }

  _cancelPressOutDelayTimeout(): void {
    if (this._pressOutDelayTimeout != null) {
      clearTimeout(this._pressOutDelayTimeout);
      this._pressOutDelayTimeout = null;
    }
  }

  _onFsPressForward_Pressability(isLongPress) {
    try {
      if (!UIManager || !UIManager.onFsPressForward) {
        return;
      }
    } catch (e) {
      return;
    }if (this._responderID == null) {
      return;
    }var nativeTag = null;if (typeof this._responderID === 'number') {
      nativeTag = this._responderID;
    } else if (typeof this._responderID === 'object' && typeof this._responderID._nativeTag === 'number') {
      nativeTag = this._responderID._nativeTag;
    }if (nativeTag == null) {
      return;
    }const { onLongPress, onPress } = this._config;var hasPress = !!onPress;var hasLongPress = !!onLongPress;UIManager.onFsPressForward(nativeTag, isLongPress, hasPress, hasLongPress);
  }

}

function normalizeDelay(delay: ?number, min = 0, fallback = 0): number {
  return Math.max(min, delay);
}

const getTouchFromPressEvent = (event: PressEvent) => {
  const { changedTouches, touches } = event.nativeEvent;

  if (touches != null && touches.length > 0) {
    return touches[0];
  }
  if (changedTouches != null && changedTouches.length > 0) {
    return changedTouches[0];
  }
  return event.nativeEvent;
};