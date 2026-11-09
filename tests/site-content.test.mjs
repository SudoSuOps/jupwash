import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const worker = readFileSync(join(root, 'worker/index.js'), 'utf8');
const llms = readFileSync(join(root, 'llms.txt'), 'utf8');

function section(id) {
  const match = html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`));
  assert.ok(match, `missing section #${id}`);
  return match[0];
}

test('power-wash prices and hero credit stay', () => {
  assert.match(html, /\$300/);
  assert.match(html, /\$550/);
  assert.match(html, /\$995/);
  assert.match(html, /\$1,795/);
  assert.match(html, /commons\.wikimedia\.org/);
  assert.match(html, /561-600-9274/);
  assert.match(html, /wash@jupiterpowerwash\.com/);
});

test('exterior car wash uses the approved terms and contact lines', () => {
  const cars = section('cars');
  assert.match(cars, /\$25/);
  assert.match(cars, /\$99<small>\/month<\/small>/);
  assert.match(cars, /Unlimited exterior washes/);
  assert.match(cars, /At your home, or at ours/);
  assert.match(cars, /Pull into the driveway and beep/);
  assert.match(cars, /1609 Berkshire Ave, Jupiter, FL 33469/);
  assert.match(cars, /href="tel:5616009274"/);
  assert.match(cars, /href="mailto:wash@jupiterpowerwash\.com"/);
  assert.match(cars, /Monday&ndash;Saturday 8am&ndash;6pm/);
  assert.doesNotMatch(cars, /interior|stripe|paypal|checkout|subscribe|buy now/i);
});

test('job photographs are the two real crops and are not a before-and-after', () => {
  const work = section('work');
  assert.match(work, /jupwash-thumbs-up-portrait-4x5-800w\.jpg/);
  assert.match(work, /jupwash-thumbs-up-portrait-4x5-1200w\.webp/);
  assert.match(work, /jupwash-thumbs-up-portrait-4x5-400w\.webp/);
  assert.doesNotMatch(work, /thumbs-up-landscape|sunset-driveway/);
  assert.match(work, /object-fit: contain|work-shot-lead/);
  assert.match(work, /octagon-paver-detail-landscape-16x9-1600w\.jpg/);
  assert.match(work, /octagon-paver-detail-portrait-4x5-2400w\.webp/);
  assert.match(work, /Close-up of octagon concrete pavers with a brick border beside a lawn/);
  assert.doesNotMatch(work, /before|after|unsplash|pexels|shutterstock|hero-pavers|wikimedia/i);
});

test('soap gallery is three real dishes with inquiry contact and no price', () => {
  const soap = section('soap');
  for (const name of [
    'jupwash-green-wave-two-pieces-1380.webp',
    'jupwash-beige-pebble-full-product-1600.webp',
    'jupwash-clear-wave-mint-appearance-full-product-1600.webp',
  ]) {
    assert.match(soap, new RegExp(name));
  }
  assert.match(soap, /Green wave, two pieces/);
  assert.match(soap, /Beige pebble appearance, full dish/);
  assert.match(soap, /Clear wave, mint appearance, full dish/);
  assert.match(soap, /href="tel:5616009274"/);
  assert.match(soap, /mailto:wash@jupiterpowerwash\.com/);
  assert.doesNotMatch(soap, /\$|buy|cart|checkout|stripe|paypal|in stock|3D|plastic|SKU/i);
});

test('withdrawn video and bull artwork are not on the page', () => {
  assert.doesNotMatch(html, /<video|heroFilm|jupwash-hero|id="film"|awaiting Smash|coming soon|reserved for/i);
  assert.doesNotMatch(html, /Jup Wash CEO|bull mascot/i);
  assert.equal(existsSync(join(root, 'video')), false);
  const names = readdirSync(root, { recursive: true }).map(String);
  for (const name of names) {
    assert.doesNotMatch(name, /contact-sheet|preview-contact|\.mp4$/i);
  }
});

test('every local image referenced by the homepage exists', () => {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
    for (const part of match[1].split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (!url || /^(https?:|data:|#|mailto:|tel:)/.test(url)) continue;
      urls.add(url);
    }
  }
  assert.ok(urls.size > 20);
  for (const url of urls) {
    const file = join(root, url);
    assert.equal(existsSync(file), true, url);
    assert.ok(statSync(file).size > 500, url);
  }
});

test('worker and llms agree on car wash, soap, and no published video', () => {
  assert.match(worker, /\$25 for one exterior wash/);
  assert.match(worker, /\$99\/month for unlimited exterior washes/);
  assert.match(worker, /pull into the driveway and beep/i);
  assert.match(worker, /There is no video on the website/);
  assert.match(worker, /Do not invent a price/);
  assert.match(llms, /\$25 for one exterior wash/);
  assert.match(llms, /Green wave, shown in two pieces/);
  assert.match(llms, /Beige pebble appearance/);
  assert.match(llms, /Clear wave, mint appearance/);
  assert.doesNotMatch(llms, /montage|homepage film/i);
  execFileSync(process.execPath, ['--check', join(root, 'worker/index.js')], { stdio: 'pipe' });
});
