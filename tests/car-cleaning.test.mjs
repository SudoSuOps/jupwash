import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const llms = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start !== -1 && end !== -1, `missing markers ${startMarker} / ${endMarker}`);
  return source.slice(start, end);
}

const cars = sliceBetween(html, 'id="cars"', 'id="solar"');

test('exterior car prices and scope stay exact', () => {
  assert.match(cars, /\$25/);
  assert.match(cars, /\$99<small>\/month<\/small>/);
  assert.match(cars, /Unlimited exterior washes/);
  assert.match(cars, /Per exterior wash/);
  assert.match(cars, /Your home or ours/);
  assert.match(cars, /Pull into the driveway and beep for an elite exterior clean/);
  assert.match(cars, /for directions/);
  assert.match(cars, /Interior cleaning is not part of this service/);
  assert.doesNotMatch(cars, /plus tax|sales tax|service fee|ceramic|interior detail|engine bay/i);
});

test('car calls to action use the published business phone and email', () => {
  assert.match(cars, /href="tel:5616009274"/);
  assert.match(cars, /href="mailto:wash@jupiterpowerwash.com"/);
  assert.doesNotMatch(cars, /href="tel:(?!5616009274)/);
  assert.doesNotMatch(cars, /stripe|paypal|checkout|subscribe|billing/i);
  assert.match(cars, /no payment and no sign-up/i);
});

test('the car gallery is ready for real photos and does not use stock', () => {
  assert.match(cars, /id="carGallery"/);
  assert.match(cars, /class="car-gallery-grid"/);
  assert.match(cars, /car-gallery" id="carGallery" hidden/);
  assert.doesNotMatch(cars, /<img\b/i);
  assert.doesNotMatch(cars, /unsplash|pexels|placeholder\.com|picsum|shutterstock|via\.placeholder/i);
});

test('existing power washing and solar offers remain', () => {
  assert.match(html, /\$300/);
  assert.match(html, /\$550/);
  assert.match(html, /\$995/);
  assert.match(html, /\$1,795/);
  assert.match(html, /id="pricing"/);
  assert.match(html, /id="services"/);
  assert.match(html, /Half Day/);
  assert.match(html, /Simple Green Oxy Solve House &amp; Siding/);
});

test('structured data and the assistant include the exterior wash without a checkout', () => {
  const jsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const business = jsonBlocks.find((block) => block['@type']?.includes('LocalBusiness'));
  assert.ok(business);
  const offers = business.hasOfferCatalog.itemListElement;
  assert.ok(offers.some((offer) => offer.price === '25' && offer.name === 'Exterior car wash'));
  assert.ok(offers.some((offer) => offer.price === '99' && offer.name === 'Unlimited exterior car washes'));
  assert.ok(offers.some((offer) => offer.price === '300'));
  assert.ok(offers.some((offer) => offer.price === '550'));

  assert.match(worker, /\$25 per exterior wash/);
  assert.match(worker, /\$99 per month for unlimited exterior washes/);
  assert.match(worker, /pull into the driveway and beep/);
  assert.match(worker, /call \$\{PHONE_DISPLAY\} for directions/);
  assert.match(worker, /No online payment, subscription, checkout, or booking link/);
  assert.match(worker, /Exterior only/);
  assert.match(llms, /\$25 per exterior wash/);
  assert.match(llms, /\$99 per month/);
  assert.match(llms, /Call 561-600-9274 for directions/);
});
