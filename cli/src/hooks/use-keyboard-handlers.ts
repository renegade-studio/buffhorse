import { useKeyboard } from '@opentui/react'
import { useCallback } from 'react'

import type { InputRenderable } from '@opentui/core'

interface KeyboardHandlersConfig {
  isStreaming: boolean
  isWaitingForResponse: boolean
  abortControllerRef: React.MutableRefObject<AbortController | null>
  focusedAgentId: string | null
  setFocusedAgentId: (id: string | null) => void
  setInputFocused: (focused: boolean) => void
  inputRef: React.MutableRefObject<InputRenderable | null>
  setCollapsedAgents: React.Dispatch<React.SetStateAction<Set<string>>>
  navigateUp: () => void
  navigateDown: () => void
}

export const useKeyboardHandlers = ({
  isStreaming,
  isWaitingForResponse,
  abortControllerRef,
  focusedAgentId,
  setFocusedAgentId,
  setInputFocused,
  inputRef,
  setCollapsedAgents,
  navigateUp,
  navigateDown,
}: KeyboardHandlersConfig) => {
  useKeyboard(
    useCallback(
      (key) => {
        const isEscape = key.name === 'escape'
        const isCtrlC = key.ctrl && key.name === 'c'

        if ((isEscape || isCtrlC) && (isStreaming || isWaitingForResponse)) {
          if (
            'preventDefault' in key &&
            typeof key.preventDefault === 'function'
          ) {
            key.preventDefault()
          }

          if (abortControllerRef.current) {
            abortControllerRef.current.abort()
          }
        }
      },
      [isStreaming, isWaitingForResponse, abortControllerRef],
    ),
  )

  useKeyboard(
    useCallback(
      (key) => {
        if (!focusedAgentId) return

        const isSpace =
          key.name === 'space' && !key.ctrl && !key.meta && !key.shift
        const isEnter =
          (key.name === 'return' || key.name === 'enter') &&
          !key.ctrl &&
          !key.meta &&
          !key.shift
        const isRightArrow =
          key.name === 'right' && !key.ctrl && !key.meta && !key.shift
        const isLeftArrow =
          key.name === 'left' && !key.ctrl && !key.meta && !key.shift

        if (!isSpace && !isEnter && !isRightArrow && !isLeftArrow) return

        if (
          'preventDefault' in key &&
          typeof key.preventDefault === 'function'
        ) {
          key.preventDefault()
        }

        if (isRightArrow) {
          setCollapsedAgents((prev) => {
            const next = new Set(prev)
            next.delete(focusedAgentId)
            return next
          })
        } else if (isLeftArrow) {
          setCollapsedAgents((prev) => {
            const next = new Set(prev)
            next.add(focusedAgentId)
            return next
          })
        } else {
          setCollapsedAgents((prev) => {
            const next = new Set(prev)
            if (next.has(focusedAgentId)) {
              next.delete(focusedAgentId)
            } else {
              next.add(focusedAgentId)
            }
            return next
          })
        }
      },
      [focusedAgentId, setCollapsedAgents],
    ),
  )

  useKeyboard(
    useCallback(
      (key) => {
        if (key.name === 'escape' && focusedAgentId) {
          if (
            'preventDefault' in key &&
            typeof key.preventDefault === 'function'
          ) {
            key.preventDefault()
          }
          setFocusedAgentId(null)
          setInputFocused(true)
          inputRef.current?.focus()
        }
      },
      [focusedAgentId, setFocusedAgentId, setInputFocused, inputRef],
    ),
  )

  useKeyboard(
    useCallback(
      (key) => {
        const isUpArrow =
          key.name === 'up' && !key.ctrl && !key.meta && !key.shift
        const isDownArrow =
          key.name === 'down' && !key.ctrl && !key.meta && !key.shift

        if (!isUpArrow && !isDownArrow) return

        if (
          'preventDefault' in key &&
          typeof key.preventDefault === 'function'
        ) {
          key.preventDefault()
        }

        if (isUpArrow) {
          navigateUp()
        } else {
          navigateDown()
        }
      },
      [navigateUp, navigateDown],
    ),
  )
}
