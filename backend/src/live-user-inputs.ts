import { logger } from './util/logger'

let liveUserInputCheckEnabled = true
export const disableLiveUserInputCheck = () => {
  liveUserInputCheckEnabled = false
}

/** Map from userId to main userInputIds */
const live: Record<string, string[]> = {}

/** Map from sessionId to WebSocket connection status */
const sessionConnections: Record<string, true | undefined> = {}

export function startUserInput(params: {
  userId: string
  userInputId: string
}): void {
  const { userId, userInputId } = params
  if (!live[userId]) {
    live[userId] = []
  }
  live[userId].push(userInputId)
}

export function cancelUserInput(params: {
  userId: string
  userInputId: string
}): void {
  const { userId, userInputId } = params
  if (live[userId] && live[userId].includes(userInputId)) {
    live[userId] = live[userId].filter((id) => id !== userInputId)
    if (live[userId].length === 0) {
      delete live[userId]
    }
  } else {
    logger.debug(
      { userId, userInputId, liveUserInputId: live[userId] ?? 'undefined' },
      'Tried to cancel user input with incorrect userId or userInputId',
    )
  }
}

export function checkLiveUserInput(
  userId: string | undefined,
  userInputId: string,
  sessionId: string,
): boolean {
  if (!liveUserInputCheckEnabled) {
    return true
  }
  if (!userId) {
    return false
  }

  // Check if WebSocket is still connected for this session
  if (!sessionConnections[sessionId]) {
    return false
  }

  if (!live[userId]) {
    return false
  }
  return live[userId].some((stored) => userInputId.startsWith(stored))
}

export function setSessionConnected(
  sessionId: string,
  connected: boolean,
): void {
  if (connected) {
    sessionConnections[sessionId] = true
  } else {
    delete sessionConnections[sessionId]
  }
}

export function getLiveUserInputIds(
  userId: string | undefined,
): string[] | undefined {
  if (!userId) {
    return undefined
  }
  return live[userId]
}

// For testing purposes - reset all state
export function resetLiveUserInputsState(): void {
  Object.keys(live).forEach((key) => delete live[key])
  Object.keys(sessionConnections).forEach(
    (key) => delete sessionConnections[key],
  )
  liveUserInputCheckEnabled = true
}
