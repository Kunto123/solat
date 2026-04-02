/**
 * core/fsm.js - Finite State Machine.
 */

import { setState, getState } from './store.js';
import { log } from '../services/platform.js';

export const STATES = Object.freeze({
  BOOT: 'BOOT',
  PRE_AZAN: 'PRE_AZAN',
  NORMAL: 'NORMAL',
  AZAN: 'AZAN',
  IQOMAH: 'IQOMAH',
  POST_IQOMAH: 'POST_IQOMAH',
  ERROR: 'ERROR',
});

const VALID_TRANSITIONS = {
  [STATES.BOOT]: [
    STATES.PRE_AZAN,
    STATES.NORMAL,
    STATES.AZAN,
    STATES.IQOMAH,
    STATES.POST_IQOMAH,
    STATES.ERROR,
  ],
  [STATES.PRE_AZAN]: [STATES.PRE_AZAN, STATES.NORMAL, STATES.AZAN, STATES.IQOMAH, STATES.POST_IQOMAH, STATES.ERROR],
  [STATES.NORMAL]: [STATES.PRE_AZAN, STATES.NORMAL, STATES.AZAN, STATES.IQOMAH, STATES.POST_IQOMAH, STATES.ERROR],
  [STATES.AZAN]: [STATES.PRE_AZAN, STATES.NORMAL, STATES.AZAN, STATES.IQOMAH, STATES.POST_IQOMAH, STATES.ERROR],
  [STATES.IQOMAH]: [STATES.PRE_AZAN, STATES.NORMAL, STATES.AZAN, STATES.IQOMAH, STATES.POST_IQOMAH, STATES.ERROR],
  [STATES.POST_IQOMAH]: [STATES.PRE_AZAN, STATES.NORMAL, STATES.AZAN, STATES.IQOMAH, STATES.POST_IQOMAH, STATES.ERROR],
  [STATES.ERROR]: [STATES.BOOT],
};

/**
 * Lakukan transisi ke state baru.
 * @param {string} nextState
 * @returns {boolean}
 */
export function transition(nextState) {
  const current = getState().fsmState;
  const allowed = VALID_TRANSITIONS[current] ?? [];

  if (!allowed.includes(nextState)) {
    log(`FSM: transisi tidak valid ${current} -> ${nextState}`, 'WARNING').catch(() => {});
    return false;
  }

  setState({ fsmState: nextState });
  return true;
}

export function currentState() {
  return getState().fsmState;
}
