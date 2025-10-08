# Codebuff Codebase Overview

## High-Level Architecture

Codebuff is a monorepo built with TypeScript and managed by `bun`. It is composed of several packages that work together to provide an AI coding assistant. The main components are a backend server, a command-line interface (CLI), a web application, and a software development kit (SDK).

### Packages

| Package | Purpose |
| --- | --- |
| `backend` | The backend server, built with Express.js. It handles the core logic of the application, including orchestrating AI agents and communicating with clients via WebSockets. |
| `npm-app` | The command-line interface (CLI) for Codebuff. It allows users to interact with the AI assistant from their terminal. |
| `web` | A Next.js application that provides a web-based interface for Codebuff, including documentation, user accounts, and pricing information. |
| `sdk` | A software development kit (SDK) that allows developers to integrate Codebuff's capabilities into their own applications. |
| `common` | A package containing shared code, types, and utilities used by the other packages in the monorepo. |
| `evals` | A set of tools and scripts for evaluating the performance of the AI agents. |
| `scripts` | A collection of scripts for automating various development tasks, such as building and testing the application. |

## Key Components

This section provides a more detailed look at the key components of each package.

### `backend`

The `backend` package is the heart of the Codebuff application. It is responsible for orchestrating the AI agents, managing WebSocket connections, and handling the core business logic.

*   **Technologies**: Express.js, TypeScript, `ws` (for WebSockets)
*   **Key Files and Directories**:
    *   `src/index.ts`: The main entry point for the backend server. It sets up the Express application, defines API routes, and initializes the WebSocket server.
    *   `src/websockets/server.ts`: This file contains the implementation of the WebSocket server, which manages client connections and message handling.
    *   `src/websockets/websocket-action.ts`: This file is responsible for processing incoming actions from clients via the WebSocket. It acts as a dispatcher, routing requests to the appropriate handlers.
    *   `src/main-prompt.ts`: This is where the core agent orchestration logic resides. It receives user prompts, selects the appropriate agent, and manages the agent's lifecycle.
    *   `src/templates/`: This directory contains the templates that define the behavior of the different AI agents.

### `npm-app`

The `npm-app` package provides the command-line interface (CLI) that developers use to interact with Codebuff. It is responsible for capturing user input, communicating with the backend, and rendering the AI's responses in the terminal.

*   **Technologies**: TypeScript, `readline`
*   **Key Files and Directories**:
    *   `src/cli.ts`: This is the main entry point for the CLI. It handles command-line arguments, manages the readline interface, and orchestrates the overall user experience.
    *   `src/client.ts`: This file contains the WebSocket client that connects to the backend server. It is responsible for sending user prompts and handling streaming responses.
    *   `src/tool-handlers.ts`: This file implements the client-side logic for the tools that the AI agents can request, such as running terminal commands or reading files.
    *   `src/display/`: This directory contains the code for rendering the UI in the terminal, including spinners, colors, and formatted output.

### `web`

The `web` package is a Next.js application that provides the web-based interface for Codebuff. It includes documentation, user account management, pricing information, and other marketing pages.

*   **Technologies**: Next.js, React, TypeScript, Tailwind CSS
*   **Key Files and Directories**:
    *   `src/app/`: This directory contains the pages and layouts of the website, following the Next.js App Router convention. Each subdirectory corresponds to a route in the application.
    *   `src/components/`: This directory contains reusable React components that are used throughout the application.
    *   `src/lib/`: This directory is a common place for utility functions and libraries that are used across the web application.
    *   `next.config.mjs`: This file contains the configuration for the Next.js application.

## Data Flow

The following diagram illustrates the data flow between the main components of the Codebuff application:

```
[ User ] -> [ npm-app (CLI) ] <--> [ backend (WebSocket) ] <--> [ AI Agents ]
```

1.  **User Input**: The user enters a prompt into the `npm-app` (the command-line interface).
2.  **CLI to Backend**: The `npm-app` sends the user's prompt to the `backend` server via a WebSocket connection.
3.  **Backend Processing**: The `backend` receives the prompt and selects the appropriate AI agent to handle the request.
4.  **Agent Execution**: The selected agent begins executing its defined steps. If the agent needs to use a tool (e.g., to read a file or run a terminal command), it sends a request back to the `npm-app` through the WebSocket.
5.  **Tool Execution**: The `npm-app` executes the requested tool and sends the result back to the `backend`.
6.  **Agent Response**: The agent processes the tool's output and continues its execution, streaming its response back to the `npm-app` in real-time.
7.  **Display Output**: The `npm-app` receives the streaming response and renders it in the terminal for the user to see.

## Getting Started

This section provides instructions for setting up the local development environment.

### Prerequisites

*   [Bun](https://bun.sh/) is used as the package manager and runtime.

### Installation

To install the dependencies for all packages, run the following command from the root of the repository:

```bash
bun install
```

### Running the Development Environment

To start the development environment, which includes the backend server, the web application, and the CLI in watch mode, run the following command:

```bash
bun run dev
```

To use a specific AI provider, you can use the `--provider` flag with the CLI:

```bash
bun run start-bin -- --provider=anthropic "Your prompt here"
```

Alternatively, you can run individual components separately:

*   **Backend Server**: `bun run start-server`
*   **Web Application**: `bun run start-web`
*   **CLI**: `bun run start-bin`

### Running Tests

To run the test suite for the main packages, use the following command:

```bash
bun test
```

### Type Checking

To perform a type check across all packages, run:

```bash
bun run typecheck
```

### Formatting Code

To format the code using Prettier, run:

```bash
bun run format
```