# CLI Package Knowledge

## Migration from Custom OpenTUI Fork

**October 2024**: Migrated from custom `CodebuffAI/opentui#codebuff/custom` fork to official `@opentui/react@^0.1.27` and `@opentui/core@^0.1.27` packages.

**Lost Features from Custom Fork:**

- `usePaste` hook - Direct paste event handling is no longer available. Terminal paste (Ctrl+V/Cmd+V) now appears as regular key input events.

**Impact:**

- Paste functionality still works through the terminal's native paste mechanism, but we can no longer intercept paste events separately from typing.
- If custom paste handling is needed in the future, it must be reimplemented using `useKeyboard` hook or by checking the official OpenTUI for updates.

## OpenTUI Text Rendering Constraints

**CRITICAL**: OpenTUI has strict requirements for text rendering that must be followed:

### JSX Content Rules

**DO NOT use `{' '}` or similar JSX expressions for whitespace in OpenTUI components.** This will cause the entire app to go blank.

```tsx
// ❌ WRONG: Will break the app
<text>Hello{' '}World</text>
<text>{'Some text'}</text>

// ✅ CORRECT: Use plain text or template literals
<text>Hello World</text>
<text content="Hello World" />
```

OpenTUI expects plain text content or the `content` prop - it does not handle JSX expressions within text elements.

## Screen Mode and TODO List Positioning

The CLI chat interface adapts its layout based on terminal dimensions:

### Screen Modes

- **Full-screen**: width ≥ 70 AND height ≥ 30
- **Wide-screen**: width ≥ 70 AND height < 30
- **Tall-screen**: width < 70 AND height ≥ 30
- **Small-screen**: width < 70 AND height < 30

### TODO List Positioning

- **Right side**: Full-screen and wide-screen modes (when there's sufficient horizontal space)
- **Top**: Tall-screen and small-screen modes (when terminal is narrow)

The TODO list automatically repositions based on available space to ensure optimal visibility and usability.

### Text Styling Components Must Be Wrapped in `<text>`

All text styling components (`<strong>`, `<em>`, `<span>`, etc.) **MUST** be nested inside a `<text>` component. They cannot be returned directly from render functions.

**INCORRECT** ❌:

```tsx
// This will cause a black screen!
function renderMarkdown(content: string) {
  return (
    <>
      <strong>Bold text</strong>
      <em>Italic text</em>
    </>
  )
}
```

**CORRECT** ✅:

```tsx
// All styling must be inside <text>
function renderMarkdown(content: string) {
  return (
    <text wrap>
      <strong>Bold text</strong>
      <em>Italic text</em>
    </text>
  )
}
```

### Why This Matters

- Returning styling components without `<text>` wrapper causes the entire app to render as a black screen
- No error messages are shown - the app just fails silently
- This applies to ALL text styling: `<strong>`, `<em>`, `<span>`, `<u>`, etc.

### Available OpenTUI Components

**Core Components**:

- `<text>` - The fundamental component for displaying all text content
- `<box>` - Container for layout and grouping
- `<input>` - Text input field
- `<select>` - Selection dropdowns
- `<scrollbox>` - Scrollable container
- `<tab-select>` - Tab-based navigation
- `<ascii-font>` - ASCII art text rendering

**Text Modifiers** (must be inside `<text>`):

- `<span>` - Generic inline styling
- `<strong>` and `<b>` - Bold text
- `<em>` and `<i>` - Italic text
- `<u>` - Underlined text
- `<br>` - Line break

### Markdown Rendering Implementation

**SUCCESS**: Rich markdown rendering has been implemented using `unified` + `remark-parse` with OpenTUI components.

**Key Insight**: OpenTUI does **not support nested `<text>` components**. Since `chat.tsx` already wraps content in a `<text>` component, the markdown renderer must return **inline JSX elements only** (no `<text>` wrappers).

**Correct Implementation Pattern**:

```tsx
// ✅ CORRECT: Return inline elements that go INSIDE the parent <text>
export function renderMarkdown(markdown: string): ReactNode {
  const inlineElements = [
    <strong>Bold text</strong>,
    ' and ',
    <em>italic text</em>,
  ]
  return <>{inlineElements}</>
}

// In chat.tsx:
;<text wrap>{renderMarkdown(message.content)}</text>
```

**Incorrect Pattern** (causes black screen):

```tsx
// ❌ WRONG: Returning <text> components creates nested <text>
export function renderMarkdown(markdown: string): ReactNode {
  return (
    <text wrap>
      <strong>Bold text</strong>
    </text>
  )
}
```

The implementation uses:

- `markdownToInline()`: Converts markdown AST to array of inline JSX elements
- `renderInlineContent()`: Renders inline styling (`<strong>`, `<em>`, `<span>`)
- Returns a fragment `<>{inlineElements}</>` that can be safely placed inside parent `<text>`

## React Reconciliation Issues

### The "Child not found in children at remove" Error

OpenTUI's React reconciler has **critical limitations** with certain conditional rendering patterns that can cause the error:

```
Error: Child not found in children
  at remove (/path/to/TextNode.ts:152:17)
  at removeChild (/path/to/host-config.ts:60:12)
```

### Root Cause

OpenTUI's reconciler struggles when:

1. **Conditionally rendering elements at the same level** using `{condition && <element>}`
2. **The parent `<text>` element switches between different child structures**
3. Components that dynamically create/remove `<span>` elements (like ShimmerText)
4. **Conditionally rendering text nodes** (including spaces like `{showText ? ' ' : ''}`)

This happens because OpenTUI's reconciler doesn't handle React's reconciliation algorithm as smoothly as standard React DOM.

### The Text Node Problem

**CRITICAL INSIGHT**: The issue isn't just about conditionally rendering elements - it also affects **TEXT NODES**. Even something as simple as a conditional space can trigger the error:

```tsx
// ❌ PROBLEMATIC: Conditionally adding/removing text nodes (including spaces)
<span>■{showText ? ' ' : ''}</span>

// ✅ WORKING: Put the conditional text inside the span content itself
<span>{showText ? '■ ' : '■'}</span>
```

In React, spaces and other text are represented as text nodes in the virtual DOM. When you write `{showText ? ' ' : ''}`, you're conditionally adding/removing a text node child, which causes OpenTUI's reconciler to fail when trying to match up children.

**Key takeaway**: Always include text content (including spaces) as part of the string literal, not as separate conditional expressions.

### ❌ PROBLEMATIC PATTERNS

**Pattern 1: Shared parent with conditional children**

```tsx
// This causes reconciliation errors!
<text wrap={false}>
  {isConnected ? (
    <>
      <span>■ </span>
      {showText && <span>connected</span>}
    </>
  ) : (
    <ShimmerText text="connecting..." />
  )}
</text>
```

**Pattern 2: Conditionally rendering entire span elements**

```tsx
// Also problematic!
<text wrap={false}>
  <span>■ </span>
  {showText && <span>connected</span>}
</text>
```

**Pattern 3: Conditionally rendering text nodes (spaces, strings, etc.)**

```tsx
// Triggers reconciliation errors!
<span>■{showText ? ' ' : ''}</span>
<span>{condition ? 'text' : ''}</span>
```

### ✅ WORKING SOLUTION

**Keep each conditional state in its own stable `<text>` wrapper:**

```tsx
// This works reliably!
{
  isConnected ? (
    <text wrap={false}>
      <span>{showText ? '■ ' : '■'}</span>
      {showText && <span>connected</span>}
    </text>
  ) : (
    <text wrap={false}>
      <ShimmerText text="connecting..." />
    </text>
  )
}
```

**Key principle:** Each major UI state (connected vs disconnected) should have its own `<text>` element. The `<text>` element itself should not change during state transitions within that UI state.

### Why This Works

- The `<text>` element for each state remains **stable**
- Only the _children_ inside each `<text>` change
- React never tries to reconcile between the connected and disconnected `<text>` elements
- The reconciler doesn't get confused trying to match up old and new children

### Best Practices

1. **Separate `<text>` elements for different UI states** - Don't try to share a single `<text>` element across major state changes
2. **Keep element structure stable** - If you need conditional content, prefer changing text content over conditionally rendering elements
3. **Avoid complex conditional rendering within OpenTUI components** - What works in React DOM may not work in OpenTUI
4. **Test thoroughly** - Reconciliation errors often appear only during specific state transitions

### Alternative Approach: Stable Element Structure

If you must use a single `<text>` element, keep the child element structure completely stable:

```tsx
// This also works - elements are always present
<text wrap={false}>
  <span>{getIndicatorText()}</span>
  <span>{getStatusText()}</span>
</text>
```

But this approach is less flexible and harder to read than using separate `<text>` elements for each state.

### Best Practice: Direct Ternary Pattern

The cleanest solution is to use a direct ternary with separate `<text>` elements:

```tsx
{
  isConnected ? (
    <text wrap={false}>
      <span>{showText ? '■ ' : '■'}</span>
      {showText && <span>connected</span>}
    </text>
  ) : (
    <text wrap={false}>
      <ShimmerText text="connecting..." />
    </text>
  )
}
```

**Why this is the best approach:**

- Clear and explicit about the two states
- Minimal abstraction - easy to understand at a glance
- Each state's `<text>` wrapper is clearly visible
- No need for additional helper components

**Note:** Helper components like `ConditionalText` are not recommended as they add unnecessary abstraction without providing meaningful benefits. The direct ternary pattern is clearer and easier to maintain.

### The "Text Must Be Created Inside of a Text Node" Error

**Error message:**

```
Error: Text must be created inside of a text node
  at createTextInstance (/path/to/host-config.ts:108:17)
```

**Root cause:** This error occurs when a component returns Fragment with `<span>` elements containing text, but the parent doesn't wrap it in a `<text>` element.

**What triggers it:**

```tsx
// Component returns Fragment with spans
const ShimmerText = ({ text }) => {
  return (
    <>
      {text.split('').map((char) => (
        <span>{char}</span> // Text nodes created here!
      ))}
    </>
  )
}

// ❌ INCORRECT: Using component without <text> wrapper
;<box>
  <ShimmerText text="hello" />
</box>
```

**The solution:** Parent components must wrap Fragment-returning components in `<text>` elements:

```tsx
// ✅ CORRECT: Parent wraps in <text>
<box>
  <text wrap={false}>
    <ShimmerText text="hello" />
  </text>
</box>
```

**Why components shouldn't self-wrap in `<text>`:**

1. Creates composition issues - you can't combine multiple components in one `<text>` element
2. Prevents flexibility in how the component is used
3. Can cause reconciliation errors when the component updates
4. Goes against React's composition principles

**Best practice:**

- Child components that render styled text should return Fragments with `<span>` elements
- Parent components are responsible for providing the `<text>` wrapper
- This follows React's pattern of "dumb" presentational components

**Component design pattern:**

```tsx
// Child component - returns Fragment
export const StyledText = ({ text, color }) => {
  return (
    <>
      <span fg={color}>{text}</span>
    </>
  )
}

// Parent component - provides <text> wrapper
const Parent = () => {
  return (
    <text wrap={false}>
      <StyledText text="hello" color="#ff0000" />
      <StyledText text="world" color="#00ff00" />
    </text>
  )
}
```

This pattern allows multiple styled components to be composed together within a single `<text>` element while avoiding the "Text must be created inside of a text node" error.

### Markdown Renderer Fragment Issue

**CRITICAL**: When `renderMarkdown()` returns a Fragment, it contains a **mix of JSX elements AND raw text strings** (newlines, text content, etc.). These raw strings become text nodes that violate OpenTUI's reconciler rules if not wrapped properly.

**The problem:**

```tsx
// renderMarkdown() returns something like:
<>
  <strong>Bold text</strong>
  '\n'                          // ⚠️ Raw string!
  <span>More content</span>
  '\n'                          // ⚠️ Raw string!
</>

// ❌ WRONG: Passing directly to <box>
<box>
  {renderMarkdown(content)}     // Raw strings create text nodes outside <text>
</box>
```

**The solution:**

```tsx
// ✅ CORRECT: Always wrap markdown output in <text>
<box>
  <text wrap>
    {renderMarkdown(content)}   // Raw strings now inside <text> element
  </text>
</box>
```

**Real-world example from BranchItem component:**

The bug occurred when tool toggles were rendered. Agent toggles worked fine, but tool toggles crashed.

**Why agents worked:**

```tsx
// Agent content always wrapped in <text>
<text wrap style={{ fg: theme.agentText }}>
  {nestedBlock.content}
</text>
```

**Why tools failed before fix:**

```tsx
// Tool content passed directly to <box> - raw strings violated reconciler rules!
<box>{displayContent} // Could be renderMarkdown() output with raw strings</box>
```

**The fix:**

```tsx
// Always wrap ALL content in <text>, whether string or ReactNode
<box>
  <text wrap fg={theme.agentText}>
    {content} // Safe for both strings and markdown Fragments
  </text>
</box>
```

**Key lesson:** Any component that receives content from `renderMarkdown()` or `renderStreamingMarkdown()` MUST wrap it in a `<text>` element, even if the content might be ReactNode. The Fragment can contain raw strings that need the text wrapper to be valid.

## Toggle Branch Rendering

Agent and tool toggles in the TUI render inside `<text>` components. Expanded content must resolve to plain strings or StyledText-compatible fragments (`<span>`, `<strong>`, `<em>`).

### TextNodeRenderable Constraint

**Problem**: Markdown-rendered content that returned arbitrary React elements (e.g., nested `<box>` containers) under `<text>` caused errors when toggling branches:

```
Error: TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances
```

**Solution**: `cli/src/components/branch-item.tsx` inspects expanded content:

- If text-renderable → stays inside `<text>`
- Otherwise → renders the raw element tree directly

This prevents invalid children from reaching `TextNodeRenderable` while preserving formatted markdown.

**Related**: `cli/src/hooks/use-message-renderer.tsx` ensures toggle headers render within a single `<text>` block for StyledText compatibility.

### Scroll Behavior

Toggling any agent/tool branch calls `scrollToAgent`, with each branch registering its container via `registerAgentRef`. This anchors the toggled item in the top third of the scrollbox for better navigation in long sessions.

## Command Menus

### Slash Commands (`/`)

Typing `/` opens a five-item slash menu above the input, mirroring npm-app commands.

**Navigation**:

- Arrow keys or Tab/Shift+Tab to move highlight
- Enter to insert selected command
- List scrolls when moving beyond first five items

### Agent Mentions (`@`)

Typing `@` scans the local `.agents` directory and surfaces agent `displayName`s (e.g., `@Codebase Commands Explorer`).

**Navigation**:

- Same as slash menu (arrows/Tab to navigate, Enter to insert)
- Both menus cap visible list at five entries

## Streaming Markdown Optimization

Streaming markdown renders as plain text until the message or agent finishes. This prevents scroll jitter that occurred when partial formatting changed line heights mid-stream.
