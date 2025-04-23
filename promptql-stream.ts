import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { createPromptQLClient } from '@hasura/promptql';
import Table from 'cli-table3';
import readline from 'readline';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env' });

// Types
type Artifact = {
  identifier: string;
  title: string;
  artifact_type: 'text' | 'table' | 'visualization';
  data: string | Record<string, unknown>[] | Record<string, unknown>;
};

type ResponseChunk =
  | { type: 'assistant_message_chunk'; message: string | null; index: number; }
  | { type: 'assistant_action_chunk'; message: string | null; plan: string | null; code: string | null; code_output: string | null; code_error: string | null; index: number; }
  | { type: 'artifact_update_chunk'; artifact: Artifact; }
  | { type: 'complete'; message: string | null; }
  | { type: 'error_chunk'; error: string; };

// Configuration
const createClient = () => createPromptQLClient({
  apiKey: process.env.PROMPTQL_APIKEY || '',
  ddn: {
    url: process.env.PROMPTQL_DDN_URL || '',
    headers: {
      'x-hasura-ddn-token': process.env.PROMPTQL_DDN_AUTH || ''
    }
  }
});

// CSV Parsing
const parseCsvFile = (filePath: string) => new Promise<string[]>((resolve, reject) => {
  const questions: string[] = [];

  createReadStream(filePath)
    .pipe(parse({ columns: true, trim: true }))
    .on('data', (row) => {
      if (row.Question) {
        questions.push(row.Question);
      }
    })
    .on('error', reject)
    .on('end', () => resolve(questions));
});

// PromptQL Query Functions
const createStreamingQuery = (userPrompt: string) => ({
  artifacts: [],
  interactions: [{ user_message: { text: userPrompt } }]
});

// Streaming Output Handlers
const clearLine = () => {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
};

const displayStreamingMessage = (message: string | null) => {
  if (message) {
    clearLine();
    process.stdout.write(`Streaming: ${message}`);
  }
};

const displayFinalOutput = (message: string | null) => {
  clearLine();
  console.log('\n\nFinal output:');
  console.log('-'.repeat(50));
  console.log(message || 'No final message received');
  console.log('-'.repeat(50));
};

// Artifact Display
const displayArtifact = (artifact: Artifact) => {
  console.log(`\n\nArtifact: ${artifact.title} (${artifact.identifier})`);
  console.log('-'.repeat(50));

  if (artifact.artifact_type === 'text') {
    console.log(artifact.data);
  } else if (artifact.artifact_type === 'table') {
    displayTableArtifact(artifact.data as Record<string, unknown>[]);
  } else if (artifact.artifact_type === 'visualization') {
    console.log('Visualization artifact:', JSON.stringify(artifact.data, null, 2));
  }

  console.log('-'.repeat(50));
};

const displayTableArtifact = (tableData: Record<string, unknown>[]) => {
  if (!tableData || tableData.length === 0 || !tableData[0]) {
    console.log('Empty table or invalid data');
    return;
  }

  const headers = Object.keys(tableData[0]);
  const table = new Table({
    head: headers,
    chars: {
      'top': '═', 'top-mid': '╤', 'top-left': '╔', 'top-right': '╗',
      'bottom': '═', 'bottom-mid': '╧', 'bottom-left': '╚', 'bottom-right': '╝',
      'left': '║', 'left-mid': '╟', 'mid': '─', 'mid-mid': '┼',
      'right': '║', 'right-mid': '╢', 'middle': '│'
    }
  });

  tableData.forEach(row => {
    table.push(headers.map(header => String(row[header] || '')));
  });

  console.log(table.toString());
};

// Main Process Runner
const processQuery = async (userPrompt: string) => {
  const client = createClient();
  let finalMessage: string | null = null;

  console.log(`Processing query: "${userPrompt}"`);

  await client.queryStream(
    createStreamingQuery(userPrompt),
    async (chunk: any) => {
      if (chunk.type === 'assistant_message_chunk' || chunk.type === 'assistant_action_chunk') {
        displayStreamingMessage(chunk.message);
      } else if (chunk.type === 'artifact_update_chunk') {
        displayArtifact(chunk.artifact);
      } else if (chunk.type === 'complete') {
        finalMessage = chunk.message;
      } else if (chunk.type === 'error_chunk' && chunk.error) {
        console.error(`Error: ${chunk.error}`);
      }
    }
  );

  displayFinalOutput(finalMessage);
};

// Main Entry Point
const main = async (csvFilePath: string) => {
  try {
    const questions = await parseCsvFile(csvFilePath);

    for (const question of questions) {
      await processQuery(question);
      // Add a pause between queries
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Error processing CSV file or running queries:', error);
    process.exit(1);
  }
};

// Run the script with a command line argument for the CSV file path
const csvFilePath = process.argv[2];
if (!csvFilePath) {
  console.error('Please provide a path to the CSV file as a command line argument');
  process.exit(1);
}

main(csvFilePath); 