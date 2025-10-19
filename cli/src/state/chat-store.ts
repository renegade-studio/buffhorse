import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import { formatTimestamp } from '../utils/helpers'

import type { ChatMessage } from '../chat'

export type ChatStoreState = {
  messages: ChatMessage[]
  streamingAgents: Set<string>
  collapsedAgents: Set<string>
  focusedAgentId: string | null
  inputValue: string
  inputFocused: boolean
  activeSubagents: Set<string>
  isChainInProgress: boolean
  slashSelectedIndex: number
  agentSelectedIndex: number
}

type ChatStoreActions = {
  setMessages: (value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  setStreamingAgents: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  setCollapsedAgents: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  setFocusedAgentId: (value: string | null | ((prev: string | null) => string | null)) => void
  setInputValue: (value: string | ((prev: string) => string)) => void
  setInputFocused: (focused: boolean) => void
  setActiveSubagents: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  setIsChainInProgress: (active: boolean) => void
  setSlashSelectedIndex: (value: number | ((prev: number) => number)) => void
  setAgentSelectedIndex: (value: number | ((prev: number) => number)) => void
  reset: () => void
}

type ChatStore = ChatStoreState & ChatStoreActions

enableMapSet()

const initialState: ChatStoreState = {
  messages: [
    {
      id: 'ai-seed-1',
      variant: 'ai',
      content:
        "Hey there! Welcome to the demo — feel free to ask anything or just say hello when you're ready.",
      timestamp: formatTimestamp(),
    },
  ],
  streamingAgents: new Set<string>(),
  collapsedAgents: new Set<string>(),
  focusedAgentId: null,
  inputValue: '',
  inputFocused: true,
  activeSubagents: new Set<string>(),
  isChainInProgress: false,
  slashSelectedIndex: 0,
  agentSelectedIndex: 0,
}

export const useChatStore = create<ChatStore>()(immer((set) => ({
  ...initialState,

  setMessages: (value) =>
    set((state) => {
      state.messages = typeof value === 'function' ? value(state.messages) : value
    }),

  setStreamingAgents: (value) =>
    set((state) => {
      state.streamingAgents = typeof value === 'function' ? value(state.streamingAgents) : value
    }),

  setCollapsedAgents: (value) =>
    set((state) => {
      state.collapsedAgents = typeof value === 'function' ? value(state.collapsedAgents) : value
    }),

  setFocusedAgentId: (value) =>
    set((state) => {
      state.focusedAgentId = typeof value === 'function' ? value(state.focusedAgentId) : value
    }),

  setInputValue: (value) =>
    set((state) => {
      state.inputValue = typeof value === 'function' ? value(state.inputValue) : value
    }),

  setInputFocused: (focused) =>
    set((state) => {
      state.inputFocused = focused
    }),

  setActiveSubagents: (value) =>
    set((state) => {
      state.activeSubagents = typeof value === 'function' ? value(state.activeSubagents) : value
    }),

  setIsChainInProgress: (active) =>
    set((state) => {
      state.isChainInProgress = active
    }),

  setSlashSelectedIndex: (value) =>
    set((state) => {
      state.slashSelectedIndex = typeof value === 'function' ? value(state.slashSelectedIndex) : value
    }),

  setAgentSelectedIndex: (value) =>
    set((state) => {
      state.agentSelectedIndex = typeof value === 'function' ? value(state.agentSelectedIndex) : value
    }),

  reset: () =>
    set((state) => {
      state.messages = initialState.messages.slice()
      state.streamingAgents = new Set(initialState.streamingAgents)
      state.collapsedAgents = new Set(initialState.collapsedAgents)
      state.focusedAgentId = initialState.focusedAgentId
      state.inputValue = initialState.inputValue
      state.inputFocused = initialState.inputFocused
      state.activeSubagents = new Set(initialState.activeSubagents)
      state.isChainInProgress = initialState.isChainInProgress
      state.slashSelectedIndex = initialState.slashSelectedIndex
      state.agentSelectedIndex = initialState.agentSelectedIndex
    }),
})))
