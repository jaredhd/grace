// TTS Worker — runs Kokoro TTS in an isolated subprocess
// Called by server.js or local/generate-video.js via child_process.spawn()
//
// The phonemizer WASM module crashes on process exit (known issue).
// Running TTS in a subprocess isolates this crash from the main server.
//
// Chunking: Kokoro truncates long text (~500 chars). This worker splits
// text into sentences and generates each separately, then concatenates.
//
// Usage: node tts-worker.mjs <text> <voice> <outputPath> [speed]
// Outputs JSON to stdout: { success: true, duration, samples, chunks } or { success: false, error }

import { KokoroTTS } from 'kokoro-js';
import { openSync, writeSync, closeSync } from 'fs';

const [,, text, voice = 'af_grace', outputPath = 'output.wav', speedStr = '1'] = process.argv;
const speed = parseFloat(speedStr) || 1;

if (!text) {
  console.log(JSON.stringify({ success: false, error: 'No text provided' }));
  process.kill(process.pid, 'SIGKILL');
}

// Split text into sentences. Each sentence becomes a chunk for Kokoro.
// Returns array of { text, pauseAfter } where pauseAfter is silence in seconds.
function chunkText(text) {
  // Split into sentences on . ? ! or ... followed by space/newline/end
  const sentences = text.match(/[^.!?\n]+[.!?…]+[\s]?|[^.!?\n]+$/g) || [text];
  const chunks = [];
  let buffer = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // If adding this sentence would exceed Kokoro's limit, flush buffer first
    if (buffer.length + trimmed.length > 400 && buffer.length > 0) {
      chunks.push(buffer.trim());
      buffer = trimmed;
    } else {
      buffer += (buffer ? ' ' : '') + trimmed;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  if (chunks.length === 0) chunks.push(text);

  // Determine pause duration after each chunk based on context
  return chunks.map((chunk, i) => {
    if (i === chunks.length - 1) return { text: chunk, pauseAfter: 0 };

    const nextChunk = chunks[i + 1] || '';
    const endsWithQuestion = /\?\s*$/.test(chunk);
    const endsWithEllipsis = /\.\.\.\s*$/.test(chunk) || /…\s*$/.test(chunk);
    const nextStartsWithConjunction = /^(And|But|So|Because|Or|Yet|Still|Maybe)\b/.test(nextChunk);
    const nextStartsNewTopic = /^(Here|What|I think|I keep|The |This |We |You )/.test(nextChunk);

    let pause;
    if (endsWithQuestion) {
      // Rhetorical questions need room to land
      pause = 1.2 + Math.random() * 0.4; // 1.2–1.6s
    } else if (endsWithEllipsis) {
      // Trailing off... let it hang
      pause = 0.9 + Math.random() * 0.3; // 0.9–1.2s
    } else if (nextStartsNewTopic) {
      // Topic shift — full breath
      pause = 1.0 + Math.random() * 0.5; // 1.0–1.5s
    } else if (nextStartsWithConjunction) {
      // Continuation — shorter, connecting
      pause = 0.4 + Math.random() * 0.2; // 0.4–0.6s
    } else {
      // Default sentence break
      pause = 0.6 + Math.random() * 0.3; // 0.6–0.9s
    }

    // Scale all pauses — tunable for tighter/looser pacing
    const PAUSE_SCALE = 0.8;
    return { text: chunk, pauseAfter: pause * PAUSE_SCALE };
  });
}

try {
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'cpu',
  });

  const chunks = chunkText(text);
  const allSamples = [];
  let sr = 24000;

  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, pauseAfter } = chunks[i];
    console.error(`  Chunk ${i + 1}/${chunks.length}: ${chunkText.length} chars, pause ${pauseAfter.toFixed(2)}s`);
    const audio = await tts.generate(chunkText, { voice, speed });
    sr = audio.sampling_rate;
    allSamples.push(audio.audio);
    if (pauseAfter > 0) {
      allSamples.push(new Float32Array(Math.round(sr * pauseAfter)));
    }
  }

  // Concatenate all sample arrays
  const totalLength = allSamples.reduce((sum, arr) => sum + arr.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of allSamples) {
    samples.set(arr, offset);
    offset += arr.length;
  }

  // Build WAV buffer
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  // WAV header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);  // PCM format
  buf.writeUInt16LE(1, 22);  // Mono
  buf.writeUInt32LE(sr, 24); // Sample rate
  buf.writeUInt32LE(sr * 2, 28); // Byte rate
  buf.writeUInt16LE(2, 32);  // Block align
  buf.writeUInt16LE(16, 34); // Bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Convert float32 samples to int16
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  // Write using low-level sync fd to ensure data is flushed before exit
  const fd = openSync(outputPath, 'w');
  writeSync(fd, buf);
  closeSync(fd);

  const duration = numSamples / sr;
  console.log(JSON.stringify({ success: true, duration: Math.round(duration * 10) / 10, samples: numSamples, sampleRate: sr, chunks: chunks.length }));
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e.message }));
}

// Force kill to prevent phonemizer WASM cleanup crash
process.kill(process.pid, 'SIGKILL');
