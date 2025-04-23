import { config } from 'dotenv';
import { createPromptQLClient } from '@hasura/promptql';

// Load environment variables from .env.example
config({ path: '.env' });

const SAMPLE_USER_PROMPT = 'Hello!';

const client = createPromptQLClient({
  apiKey: process.env.PROMPTQL_APIKEY || '<your-promptql-api-key>', // Use env var or default
  ddn: {
    url: process.env.PROMPTQL_DDN_URL || '<your-project-endpoint>', // Use env var or default
    headers: {
      'x-hasura-ddn-token': process.env.PROMPTQL_DDN_AUTH || '<credential>'
    }
  }
});

const runQuery = (text: string) => {
  return client.query({
    artifacts: [],
    interactions: [
      {
        user_message: {
          text,
        }
      }
    ],
    ddn: {
      // you can override the default ddn config, 
      // for example, dynamic auth credentials
      headers: {}
    }
  });
};

// runQuery('what can you do?').then((response) => {
//   console.log(response);
// });

client.queryStream({
  artifacts: [],
  interactions: [{ user_message: { text: SAMPLE_USER_PROMPT } }],
}, async (chunk) => {
  console.log(chunk.message);
});