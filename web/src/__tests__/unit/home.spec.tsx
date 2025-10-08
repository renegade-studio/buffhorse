/// <reference lib="dom" />
import { render, screen } from '@testing-library/react'
import { mock, fn } from 'bun:test'

// Mock next-auth session to avoid requiring a SessionProvider
mock.module('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

import Home from '../../app/page'

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: fn((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: fn(),
    removeListener: fn(),
    addEventListener: fn(),
    removeEventListener: fn(),
    dispatchEvent: fn(),
  })),
})

// Set a default window.innerWidth
Object.defineProperty(window, 'innerWidth', {
  writable: true,
  value: 1024,
})

// Mock next/navigation
mock.module('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

// Mock PostHog
mock.module('posthog-js', () => ({
  capture: fn(),
}))

// Mock components used in Home page
mock.module('../../components/ui/hero', () => ({
  Hero: () => <div data-testid="hero">Hero Component</div>,
}))

mock.module('../../components/ui/landing/feature', () => ({
  FeatureSection: () => (
    <div data-testid="feature-section">Feature Section</div>
  ),
}))

mock.module('../../components/ui/landing/competition', () => ({
  CompetitionSection: () => (
    <div data-testid="competition-section">Competition Section</div>
  ),
}))

mock.module('../../components/ui/landing/testimonials-section', () => ({
  TestimonialsSection: () => (
    <div data-testid="testimonials-section">Testimonials Section</div>
  ),
}))

mock.module('../../components/ui/landing/cta-section', () => ({
  CTASection: () => <div data-testid="cta-section">CTA Section</div>,
}))

mock.module('../../components/IDEDemo', () => ({
  __esModule: true,
  default: () => <div data-testid="ide-demo">IDE Demo</div>,
}))

// Mock decorative blocks
mock.module('../../components/ui/decorative-blocks', () => ({
  DecorativeBlocks: ({ children }: { children: React.ReactNode }) => children,
  BlockColor: {
    CRTAmber: 'crt-amber',
    AcidMatrix: 'acid-matrix',
  },
}))

// Mock section component
mock.module('../../components/ui/section', () => ({
  Section: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

describe('Homepage', () => {
  it('renders the main components', () => {
    render(<Home />)

    expect(screen.getByTestId('hero')).toBeInTheDocument()
    expect(screen.getAllByTestId('feature-section')).toHaveLength(3)
    expect(screen.getByTestId('competition-section')).toBeInTheDocument()
    expect(screen.getByTestId('testimonials-section')).toBeInTheDocument()
    expect(screen.getByTestId('cta-section')).toBeInTheDocument()
    expect(screen.getByTestId('ide-demo')).toBeInTheDocument()
  })
})