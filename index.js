#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const BUG_WORDS = ['bug', 'broken', 'crash', 'crashes', 'error', 'errors', 'fails', 'failing', "doesn't work", 'not working', 'regression'];
const CHORE_WORDS = ['refactor', 'cleanup', 'clean up', 'update deps', 'dependency', 'dependencies', 'docs', 'documentation', 'rename', 'migrate', 'migration', 'upgrade'];
const HIGH_WORDS = ['urgent', 'asap', 'critical', 'blocker', 'blocking', 'must', 'immediately'];
const LOW_WORDS = ['nice to have', 'eventually', 'someday', 'low priority', 'minor', 'whenever'];
const CRITERIA_MARKERS = [' should ', ' must ', ' needs to ', ' has to ', ' when ', ' until ', ' so that '];

function splitIntoChunks(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const chunks = [];
  let current = [];

  const isBulletStart = (line) => /^\s*([-*+]|\d+[.)])\s+/.test(line);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') {
      if (current.length) {
        chunks.push(current.join(' ').trim());
        current = [];
      }
      continue;
    }
    if (isBulletStart(rawLine) && current.length) {
      chunks.push(current.join(' ').trim());
      current = [];
    }
    current.push(line.replace(/^([-*+]|\d+[.)])\s+/, ''));
  }
  if (current.length) chunks.push(current.join(' ').trim());

  return chunks.filter((c) => c.length > 0);
}

function detectType(text) {
  const lower = text.toLowerCase();
  if (BUG_WORDS.some((w) => lower.includes(w))) return 'bug';
  if (CHORE_WORDS.some((w) => lower.includes(w))) return 'chore';
  return 'feature';
}

function detectPriority(text) {
  const lower = text.toLowerCase();
  if (HIGH_WORDS.some((w) => lower.includes(w))) return 'high';
  if (LOW_WORDS.some((w) => lower.includes(w))) return 'low';
  return 'medium';
}

function detectEstimate(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 15) return 'XS';
  if (words < 40) return 'S';
  if (words < 80) return 'M';
  return 'L';
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractAcceptanceCriteria(text) {
  const sentences = splitSentences(text);
  const criteria = sentences.filter((s) => {
    const lower = ` ${s.toLowerCase()} `;
    return CRITERIA_MARKERS.some((m) => lower.includes(m));
  });
  if (criteria.length === 0) {
    return ['Implement as described in the ticket description.'];
  }
  return criteria;
}

function makeTitle(text) {
  const firstSentence = splitSentences(text)[0] || text;
  const MAX = 72;
  if (firstSentence.length <= MAX) return firstSentence.replace(/[.?!]+$/, '');
  return firstSentence.slice(0, MAX - 1).trim() + '…';
}

function chunkToTicket(text) {
  return {
    title: makeTitle(text),
    description: text,
    type: detectType(text),
    priority: detectPriority(text),
    estimate: detectEstimate(text),
    acceptanceCriteria: extractAcceptanceCriteria(text),
  };
}

function csvEscape(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function ticketsToCSV(tickets) {
  const header = ['Title', 'Description', 'Type', 'Priority', 'Estimate', 'Labels', 'Acceptance Criteria'];
  const rows = tickets.map((t) => [
    t.title,
    t.description,
    t.type,
    t.priority,
    t.estimate,
    `${t.type},${t.priority}`,
    t.acceptanceCriteria.map((c) => `- ${c}`).join('\n'),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function ticketsToMarkdown(tickets) {
  const lines = ['# Tickets', ''];
  tickets.forEach((t, i) => {
    lines.push(`## ${i + 1}. ${t.title}`);
    lines.push('');
    lines.push(`**Type:** ${t.type} | **Priority:** ${t.priority} | **Estimate:** ${t.estimate}`);
    lines.push('');
    lines.push('**Description:**');
    lines.push(t.description);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    t.acceptanceCriteria.forEach((c) => lines.push(`- [ ] ${c}`));
    lines.push('');
  });
  return lines.join('\n');
}

async function polishWithAI(tickets, apiKey) {
  const prompt = `You are helping turn a rough brain-dump into clean, well-formed tickets. I'll give you a JSON array of draft tickets (title, description, type, priority, estimate, acceptanceCriteria). Improve the titles (clear, action-oriented, <=72 chars), tighten the descriptions, and improve acceptanceCriteria to be concrete, testable bullet points. Keep the same type, priority, and estimate values and the same number of tickets, same order. Respond with ONLY a JSON array in the same shape, no commentary.\n\nDraft tickets:\n${JSON.stringify(tickets, null, 2)}`;

  const body = JSON.stringify({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Anthropic API returned status ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content.map((c) => c.text || '').join('');
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('No JSON array found in AI response');
            resolve(JSON.parse(jsonMatch[0]));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function printUsage() {
  console.log(`brain-dump-to-tickets

Usage:
  node index.js <input-file> [options]

Options:
  --out <dir>   Output directory (default: same directory as input file)
  --ai          Polish tickets with Claude (requires ANTHROPIC_API_KEY env var)
  --help        Show this help

Example:
  node index.js example/sample-braindump.txt
  node index.js notes.txt --out ./tickets --ai
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const inputFile = args[0];
  const outIndex = args.indexOf('--out');
  const outDir = outIndex !== -1 ? args[outIndex + 1] : path.dirname(path.resolve(inputFile));
  const useAI = args.includes('--ai');

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: input file not found: ${inputFile}`);
    process.exit(1);
  }

  const text = fs.readFileSync(inputFile, 'utf8');
  const chunks = splitIntoChunks(text);

  if (chunks.length === 0) {
    console.error('Error: no content found in input file.');
    process.exit(1);
  }

  let tickets = chunks.map(chunkToTicket);

  if (useAI) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('Warning: --ai passed but ANTHROPIC_API_KEY is not set. Falling back to heuristic output.');
    } else {
      try {
        console.log('Polishing tickets with Claude...');
        const polished = await polishWithAI(tickets, apiKey);
        if (Array.isArray(polished) && polished.length === tickets.length) {
          tickets = polished;
        } else {
          console.warn('Warning: AI response shape unexpected. Falling back to heuristic output.');
        }
      } catch (err) {
        console.warn(`Warning: AI polish failed (${err.message}). Falling back to heuristic output.`);
      }
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, 'tickets.md');
  const csvPath = path.join(outDir, 'tickets.csv');

  fs.writeFileSync(mdPath, ticketsToMarkdown(tickets), 'utf8');
  fs.writeFileSync(csvPath, ticketsToCSV(tickets), 'utf8');

  console.log(`Generated ${tickets.length} ticket(s):`);
  console.log(`  ${mdPath}`);
  console.log(`  ${csvPath}`);
}

main();
