// TTS Worker — runs Kokoro TTS in an isolated subprocess
// Called by server.js via child_process.fork()
//
// The phonemizer WASM module crashes on process exit (known issue).
// Running TTS in a subprocess isolates this crash from the main server.
//
// Usage: node tts-worker.mjs <text> <voice> <outputPath>
// Outputs JSON to stdout: { success: true, duration, samples } or { success: false, error }

import { KokoroTTS } from 'kokoro-js';
import { openSync, writeSync, closeSync } from 'fs';

const [,, text, voice = 'af_heart', outputPath = 'output.wav'] = process.argv;

if (!text) {
  console.log(JSON.stringify({ success: false, error: 'No text provided' }));
  process.kill(process.pid, 'SIGKILL');
}

try {
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'cpu',
  });

  const audio = await tts.generate(text, { voice });
  const samples = audio.audio; // Float32Array
  const sr = audio.sampling_rate; // 24000

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
  console.log(JSON.stringify({ success: true, duration: Math.round(duration * 10) / 10, samples: numSamples, sampleRate: sr }));
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e.message }));
}

// Force kill to prevent phonemizer WASM cleanup crash
process.kill(process.pid, 'SIGKILL');
