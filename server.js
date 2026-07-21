require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');

const execAsync = promisify(exec);
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.WAVESPEED_API_KEY;
const API_BASE = 'https://api.wavespeed.ai/api/v3';
const TEMP_DIR = path.join(__dirname, 'temp');
const OUTPUT_DIR = path.join(__dirname, 'output');

[TEMP_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const jobs = new Map();

// Fallback: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API helpers
async function wavespeedPost(endpoint, body) {
  try {
    const res = await axios.post(`${API_BASE}${endpoint}`, body, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    return res.data.data ?? res.data;
  } catch (err) {
    const details = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[WaveSpeed ERROR] ${endpoint}: ${details}`);
    throw new Error(`WaveSpeed ${endpoint} failed: ${details}`);
  }
}

async function wavespeedGetResult(predictionId) {
  const res = await axios.get(`${API_BASE}/predictions/${predictionId}/result`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    timeout: 10000
  });
  return res.data.data ?? res.data;
}

async function pollPrediction(predictionId, interval = 3000, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await wavespeedGetResult(predictionId);
    if (result.status === 'completed' || result.status === 'succeeded') return result;
    if (['failed', 'cancelled', 'timeout', 'error'].includes(result.status)) {
      throw new Error(`Job failed: ${result.failed_reason || result.error?.message || JSON.stringify(result)}`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Polling timeout');
}

async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest);
  const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 60000 });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });
}

async function generateImage(prompt, jobId) {
  console.log(`[${jobId}] Step 1: GPT Image 2...`);
  const task = await wavespeedPost('/openai/gpt-image-2/text-to-image', {
    prompt,
    aspect_ratio: '9:16',
    resolution: '1k',
    quality: 'medium'
  });
  const result = await pollPrediction(task.id, 3000, 60);
  const imageUrl = result.outputs?.[0] || result.output?.images?.[0] || result.output;
  if (!imageUrl || !imageUrl.startsWith('http')) throw new Error('No image URL');
  const imagePath = path.join(TEMP_DIR, `${jobId}_image.png`);
  await downloadFile(imageUrl, imagePath);
  console.log(`[${jobId}] Image: ${imagePath}`);
  return { url: imageUrl, path: imagePath };
}

async function generateVideo(imageUrl, prompt, duration, jobId) {
  console.log(`[${jobId}] Step 2: Seedance 2.0...`);
  const task = await wavespeedPost('/bytedance/seedance-2.0/image-to-video', {
    prompt,
    image: imageUrl,
    aspect_ratio: '9:16',
    resolution: '720p',
    duration: parseInt(duration),
    generate_audio: true
  });
  const result = await pollPrediction(task.id, 5000, 120);
  const videoUrl = result.outputs?.[0] || result.output?.video?.[0] || result.output;
  if (!videoUrl || !videoUrl.startsWith('http')) throw new Error('No video URL');
  const videoPath = path.join(TEMP_DIR, `${jobId}_video.mp4`);
  await downloadFile(videoUrl, videoPath);
  console.log(`[${jobId}] Video: ${videoPath}`);
  return { url: videoUrl, path: videoPath };
}

async function generateVoice(text, jobId) {
  console.log(`[${jobId}] Step 3: OmniVoice TTS...`);
  // ИСПРАВЛЕНИЕ: только допустимые дескрипторы через запятую + пробел
  const task = await wavespeedPost('/wavespeed-ai/omnivoice/text-to-speech', {
    text,
    speed: 1.0,
    voice_description: 'male, young adult, low pitch'
  });
  const result = await pollPrediction(task.id, 2000, 60);
  const audioUrl = result.outputs?.[0] || result.output;
  if (!audioUrl || !audioUrl.startsWith('http')) throw new Error('No audio URL');
  const audioPath = path.join(TEMP_DIR, `${jobId}_voice.mp3`);
  await downloadFile(audioUrl, audioPath);
  console.log(`[${jobId}] Voice: ${audioPath}`);
  return { url: audioUrl, path: audioPath };
}

async function mergeVideoAudio(videoPath, audioPath, outputPath, jobId) {
  console.log(`[${jobId}] Step 4: FFmpeg merge...`);
  const cmd = `"${ffmpegPath}" -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest -movflags +faststart "${outputPath}"`;
  await execAsync(cmd);
  console.log(`[${jobId}] Final: ${outputPath}`);
  return outputPath;
}

async function runPipeline(jobId, { prompt, voiceText, duration }) {
  const job = jobs.get(jobId);
  try {
    job.step = 'image'; job.progress = 10;
    const image = await generateImage(prompt, jobId);
    job.imageUrl = image.url; job.progress = 30;

    job.step = 'video'; job.progress = 35;
    const video = await generateVideo(image.url, prompt, duration, jobId);
    job.videoUrl = video.url; job.progress = 60;

    job.step = 'voice'; job.progress = 65;
    const voice = await generateVoice(voiceText, jobId);
    job.progress = 80;

    job.step = 'merge'; job.progress = 85;
    const finalPath = path.join(OUTPUT_DIR, `${jobId}_final.mp4`);
    await mergeVideoAudio(video.path, voice.path, finalPath, jobId);
    job.progress = 100; job.step = 'done'; job.status = 'completed';
    job.resultUrl = `/output/${jobId}_final.mp4`;

    setTimeout(() => {
      try { fs.unlinkSync(image.path); fs.unlinkSync(video.path); fs.unlinkSync(voice.path); } catch(e) {}
    }, 120000);

  } catch (err) {
    console.error(`[${jobId}] Error:`, err.message);
    job.status = 'failed'; job.error = err.message; job.step = 'error';
  }
}

app.post('/api/generate', async (req, res) => {
  const { prompt, voiceText, duration = 5 } = req.body;
  if (!prompt || !voiceText) return res.status(400).json({ error: 'prompt and voiceText required' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { id: jobId, status: 'processing', step: 'init', progress: 0, prompt, voiceText, duration });
  runPipeline(jobId, { prompt, voiceText, duration });
  res.json({ jobId, status: 'processing' });
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ id: job.id, status: job.status, step: job.step, progress: job.progress, resultUrl: job.resultUrl, error: job.error });
});

app.get('/output/:filename', (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`FFmpeg path: ${ffmpegPath}`);
});
