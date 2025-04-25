# PromptQL CSV Processor

A command-line utility for processing CSV files and sending the questions to PromptQL API as streaming queries.

## Features

- Parse CSV files and extract questions
- Submit questions as streaming queries to PromptQL
- Display streaming responses in real-time
- Process and visualize artifacts returned by PromptQL
- Show final responses separately from streaming output
- Visual spinner animation during action processing

## Installation

1. Clone this repository
2. Install dependencies:

```bash
bun install
```

3. Create a `.env` file based on `.env.example` with your PromptQL API credentials

## Usage

Run the script with a path to your CSV file:

```bash
bun run index.ts test-evalset.csv
```

### CSV Format

The CSV file should have a column named "Question" that contains the text to send to PromptQL.

Example:

```
Question,Category,Priority
"What is PromptQL?",General,High
"How do I connect to a database with PromptQL?",Database,Medium
```

## UI Features

### Spinner Animation

The application displays a visual spinner animation when the PromptQL engine is processing actions using the [ora](https://github.com/sindresorhus/ora) library. This provides elegant visual feedback during:

- Code execution
- Plan generation
- Any other computational actions

The spinner automatically stops when text output, artifacts, or errors are received.

## Architecture

The application follows functional programming patterns and SOLID principles:

- **Single Responsibility Principle**: Each function has a single, well-defined purpose
- **Dependency Inversion**: Configuration is passed as arguments
- **Functional Style**: Pure functions with minimal side effects where possible
- **Modular Design**: Components are separated by responsibility

## Dependencies

- `csv-parse`: CSV file parsing
- `cli-table3`: ASCII table rendering for artifacts
- `readline`: Terminal output management
- `@hasura/promptql`: PromptQL TypeScript SDK
- `ora`: Elegant terminal spinner

## License

MIT
