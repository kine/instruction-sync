# Instruction Sync Extension - Development Guidelines

This is a VS Code extension project written in TypeScript.

## Project Structure

- `src/extension.ts` - Main extension entry point with activation and command registration
- `package.json` - Extension manifest with commands, configuration schema, and metadata
- `esbuild.js` - Build configuration for bundling the extension

## Coding Guidelines

- Use TypeScript strict mode
- Follow VS Code extension best practices
- Use async/await for asynchronous operations
- Handle errors gracefully with try/catch blocks
- Show appropriate user feedback via `vscode.window.showInformationMessage` and `vscode.window.showErrorMessage`

## Key Concepts

- The extension syncs Copilot instructions from remote URLs to `.github/copilot-instructions.md`
- Language detection is based on file extensions in the workspace
- Configuration is stored in VS Code settings under `instructionSync.*`
