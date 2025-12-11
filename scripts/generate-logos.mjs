#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment. Add it to .env.local');
  process.exit(1);
}

const groups = ['investors', 'founders', 'operators'];
const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'public', 'investors');
const destRoot = path.join(projectRoot, 'public', 'investors_v2');
const force = process.env.FORCE_REGEN === '1';

// Optional targeting: ONLY=operators/dropbox.jpeg,operators/harvey.jpeg
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const prompt = 'Create a version of this logo but that is slightly different to fill 1792x1024 image please';
// OpenAI supported sizes: '1024x1024', '1024x1536', '1536x1024', 'auto'
// We'll request 1536x1024 (landscape), then crop to 1792x1024 (cover) – no bars.
const size = '1536x1024';
const apiBackground = process.env.BG_MODE || 'auto'; // 'auto' | 'transparent' | 'opaque'
const outputBackground = process.env.OUTPUT_BG || 'white'; // 'white' | 'transparent'

/**
 * Call OpenAI Images Edits endpoint with an input image and prompt.
 * Returns a Buffer of PNG bytes.
 */
async function editImage({ filePath }) {
  const url = 'https://api.openai.com/v1/images/edits';
  const fileName = path.basename(filePath).replace(/\.(jpe?g|png|webp)$/i, '.png');
  const fileExt = path.extname(filePath).toLowerCase();
  const mime = fileExt === '.png' ? 'image/png' : fileExt === '.webp' ? 'image/webp' : 'image/jpeg';

  const bytes = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('background', apiBackground);
  form.append('image', new Blob([bytes], { type: mime }), fileName);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error (${res.status}): ${text}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data returned');
  return Buffer.from(b64, 'base64');
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function getOnlyFilesForGroup(group) {
  if (ONLY.length === 0) return null;
  const prefix = `${group}/`;
  const files = ONLY.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length));
  return new Set(files);
}

async function generateForGroup(group) {
  const srcDir = path.join(srcRoot, group);
  const destDir = path.join(destRoot, group);
  await ensureDir(destDir);
  const entries = await fs.promises.readdir(srcDir);
  const filterSet = getOnlyFilesForGroup(group);
  const files = entries
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .filter((f) => (filterSet ? filterSet.has(f) : true));
  console.log(`Processing ${group}: ${files.length} files`);

  for (const file of files) {
    const srcFile = path.join(srcDir, file);
    const base = path.basename(file).replace(/\.(png|jpe?g|webp)$/i, '');
    const destFile = path.join(destDir, `${base}.png`);
    if (fs.existsSync(destFile) && !force) {
      console.log(`✔️  Skip (exists): ${group}/${base}.png`);
      continue;
    }
    try {
      console.log(`→ Generating: ${group}/${file}`);
      const png = await editImage({ filePath: srcFile });
      const white = { r: 255, g: 255, b: 255, alpha: 1 };
      const background = outputBackground === 'white' ? white : { r: 0, g: 0, b: 0, alpha: 0 };
      let pipeline = sharp(png);
      if (outputBackground === 'white') pipeline = pipeline.flatten({ background });
      const resized = await pipeline
        .resize(1792, 1024, { fit: 'cover', position: 'centre', background })
        .png()
        .toBuffer();
      await fs.promises.writeFile(destFile, resized);
      console.log(`✔️  Wrote: ${path.relative(projectRoot, destFile)}`);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`✖️  Failed: ${group}/${file}`);
      console.error(String(err));
    }
  }
}

async function main() {
  for (const g of groups) {
    await generateForGroup(g);
  }
  console.log('Done. New assets in public/investors_v2');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


