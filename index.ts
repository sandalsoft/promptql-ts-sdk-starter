import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { createPromptQLClient } from '@hasura/promptql';
import Table from 'cli-table3';
import readline from 'readline';
import { config } from 'dotenv';
import ora from 'ora';

// Load environment variables
config({ path: '.env' });

// Types
type Artifact = {
  identifier: string;
  title: string;
  artifact_type: 'text' | 'table' | 'visualization';
  data: string | Record<string, unknown>[] | Record<string, unknown>;
};

// Spinner instance
let spinner = ora({
  text: 'Working',
  color: 'cyan'
});

// State tracking
let isOutputting = false;

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
    process.stdout.write(message);
  }
};

const displayFinalOutput = (message: string | null) => {
  // Ensure spinner is stopped
  if (spinner.isSpinning) {
    spinner.stop();
  }

  console.log('\n\nFinal output:');
  console.log('-'.repeat(50));
  console.log(message || 'No final message received');
  console.log('-'.repeat(50));
};

// Artifact Display
const displayArtifact = (artifact: Artifact) => {
  // Ensure spinner is stopped
  if (spinner.isSpinning) {
    spinner.stop();
  }

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
  isOutputting = true;
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
const processQuery = async (userPrompt: string): Promise<{
  finalMessage: string | null,
  betweenArtifactsMessage: string | null,
  lastTwoSentencesMessage: string | null;
}> => {
  const client = createClient();
  let finalMessage: string | null = null;

  // Variables to track artifacts and messages between them
  const artifactTimestamps: number[] = [];
  let messageBetweenArtifacts: string = '';
  let lastArtifactTime: number = 0;
  let betweenArtifactsMessage: string | null = null;

  // Variable to collect all streamed text
  let allStreamedText: string = '';

  // Reset state
  if (spinner.isSpinning) {
    spinner.stop();
  }

  console.log(`Processing query: "${userPrompt}"`);

  await client.queryStream(
    createStreamingQuery(userPrompt),
    async (chunk: any) => {
      const currentTime = Date.now();

      // Handle different chunk types
      switch (chunk.type) {
        case 'assistant_message_chunk':
          if (spinner.isSpinning) spinner.stop();

          // Collect all streamed text
          if (chunk.message) {
            allStreamedText += chunk.message;
          }

          // If we've seen at least one artifact, collect message text
          if (lastArtifactTime > 0) {
            messageBetweenArtifacts += chunk.message || '';
          }

          displayStreamingMessage(chunk.message);
          break;

        case 'assistant_action_chunk':
          // Display message if present
          if (chunk.message) {
            if (spinner.isSpinning) spinner.stop();

            // Collect all streamed text
            allStreamedText += chunk.message;

            // If we've seen at least one artifact, collect message text
            if (lastArtifactTime > 0) {
              messageBetweenArtifacts += chunk.message || '';
            }

            displayStreamingMessage(chunk.message);
          }

          // Start spinner if there's a plan or code
          if (chunk.plan || chunk.code) {
            if (!spinner.isSpinning) {
              console.log(); // Add line break
              spinner.start();
            }
          }
          break;

        case 'artifact_update_chunk':
          if (spinner.isSpinning) spinner.stop();

          // Record this artifact timestamp
          artifactTimestamps.push(currentTime);

          // If this is at least the second artifact, save the message between them
          if (artifactTimestamps.length >= 2) {
            // The message between the previous artifact and this one
            betweenArtifactsMessage = messageBetweenArtifacts.trim();
            // Reset for next potential message between artifacts
            messageBetweenArtifacts = '';
          }

          // Update the last artifact time
          lastArtifactTime = currentTime;

          displayArtifact(chunk.artifact);
          break;

        case 'complete':
          if (spinner.isSpinning) spinner.stop();
          finalMessage = chunk.message;
          break;

        case 'error_chunk':
          if (spinner.isSpinning) spinner.stop();
          if (chunk.error) {
            console.error(`\nError: ${chunk.error}`);
          }
          break;
      }
    }
  );

  // Ensure spinner is stopped at the end
  if (spinner.isSpinning) {
    spinner.stop();
  }

  // Extract the last two sentences
  const lastTwoSentencesMessage = extractLastTwoSentences(allStreamedText);

  // Display all final message types
  displayFinalOutput(finalMessage);

  if (betweenArtifactsMessage) {
    console.log('\nMessage between final artifacts:');
    console.log('-'.repeat(50));
    console.log(betweenArtifactsMessage);
    console.log('-'.repeat(50));
  }

  if (lastTwoSentencesMessage) {
    console.log('\nLast two sentences:');
    console.log('-'.repeat(50));
    console.log(lastTwoSentencesMessage);
    console.log('-'.repeat(50));
  }

  // Return all message types
  return {
    finalMessage,
    betweenArtifactsMessage,
    lastTwoSentencesMessage
  };
};

// Function to extract the last two sentences from text
const extractLastTwoSentences = (text: string): string | null => {
  if (!text || !text.trim()) return null;

  // Clean up the text
  const cleanedText = text.trim()
    // Remove artifact markers
    .replace(/<artifact.*?\/>/g, '')
    // Replace multiple spaces/newlines with single space
    .replace(/\s+/g, ' ');

  // Use a manual approach to find the last two sentences
  const sentenceEndingChars = ['.', '!', '?'];
  const sentences: string[] = [];
  let currentSentence = "";

  // Process character by character
  for (let i = 0; i < cleanedText.length; i++) {
    currentSentence += cleanedText[i];

    // Check if we're at the end of a sentence
    if (
      sentenceEndingChars.includes(cleanedText[i] || '') &&
      (i === cleanedText.length - 1 || cleanedText[i + 1] === ' ')
    ) {
      sentences.push(currentSentence.trim());
      currentSentence = "";
    }
  }

  // Add any remaining text as a sentence
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  // Get the last two sentences if available
  if (sentences.length === 0) return null;
  if (sentences.length === 1) return sentences[0] || null;

  const lastTwoSentences = sentences.slice(-2);
  return lastTwoSentences.join(' '); // This will always be a string
};

// Main Entry Point
const main = async (csvFilePath: string) => {
  try {
    const questions = await parseCsvFile(csvFilePath);
    const results: Array<{
      question: string,
      finalMessage: string | null,
      betweenArtifactsMessage: string | null,
      lastTwoSentencesMessage: string | null;
    }> = [];

    for (const question of questions) {
      const { finalMessage, betweenArtifactsMessage, lastTwoSentencesMessage } = await processQuery(question);
      results.push({
        question,
        finalMessage,
        betweenArtifactsMessage,
        lastTwoSentencesMessage
      });

      // Add a pause between queries
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Optional: Log summary of all final messages
    // console.log('\n===== SUMMARY OF RESULTS =====');
    // results.forEach(({ question, finalMessage, betweenArtifactsMessage, lastTwoSentencesMessage }) => {
    //   console.log(`\nQuestion: ${question}`);
    //   console.log(`Complete message: ${finalMessage || 'No final message received'}`);
    //   console.log(`Between artifacts: ${betweenArtifactsMessage || 'No message between artifacts'}`);
    //   console.log(`Last two sentences: ${lastTwoSentencesMessage || 'No sentences found'}`);
    //   console.log('-'.repeat(50));
    // });

    // Optional: Return results for further processing
    return results;
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