// Generates the social sharing cards (1200×630) in public/og/ that WhatsApp,
// Facebook and X show when a page is shared. Run: npm run og
// Uses sharp (installed with Astro) and the fonts in scripts/og/.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/og');
mkdirSync(out, { recursive: true });
const font = (f) => join(root, 'scripts/og', f);

const W = 1200;
const H = 630;
const ACCENT = '#3fd17f';

// file name → photo, small label, headline
const CARDS = [
  ['default', 'mini-fusions', 'Fusion Football Club', 'Where players grow. Where people belong.', '50% 25%'],
  ['teams', 'coach-directing', 'Our teams', 'Find your team at Fusion FC', '50% 35%'],
  ['team', 'session-group-young', 'Fusion FC', 'Meet the team', '50% 40%'],
  ['fixtures', 'player-shooting', 'Fixtures & results', 'Every Fusion FC game, kept up to date', '55% 45%'],
  ['vacancies', 'girls-session', 'Join the Fusion family', 'Teams with a space for you', '50% 55%'],
  ['join', 'session-group-young', 'Get involved', 'Join Fusion FC', '50% 40%'],
  ['about', 'coach-directing', 'Our story', 'About Fusion Football Club', '45% 40%'],
  ['development', 'players-training-bibs', 'Open to all', 'Development Sessions', '50% 40%'],
  ['her-game-too', 'girls-session-evening', 'Partnership', 'Fusion FC × Her Game Too', '50% 50%'],
  ['age-groups', 'player-shooting', 'Player pathways', 'Age Groups & Team Pathways', '55% 50%'],
  ['leagues', 'fusion-kit-pitch', 'League competition', 'Leagues & Competitions', '50% 70%'],
  ['contact', 'coach-directing', 'Get in touch', 'Contact Fusion FC', '50% 35%'],
  ['sponsors', 'fusion-kit-pitch', 'Partners wanted', 'Sponsor Fusion FC', '50% 70%'],
  ['blog', 'players-training-bibs', 'Club updates', 'News from Fusion FC', '50% 40%'],
  ['club', 'fusion-kit-pitch', 'Club information', 'Fusion Football Club', '50% 70%']
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Font file → family name Pango should use from it.
const FAMILY = { 'InterTight-Bold.ttf': 'Inter Tight Bold', 'Inter-Medium.ttf': 'Inter Medium' };

async function text(markup, file, size, width) {
  return sharp({
    text: { text: markup, fontfile: font(file), font: `${FAMILY[file]} ${size}`, width, rgba: true, wrap: 'word', spacing: Math.round(size * 0.05) }
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

for (const [name, photo, label, title, pos] of CARDS) {
  const [px, py] = pos.split(' ').map((v) => parseFloat(v) / 100);
  const meta = await sharp(join(root, 'public/images/web', `${photo}.jpg`)).metadata();
  // Cover-crop the photo to 1200×630 around the focal point.
  const scale = Math.max(W / meta.width, H / meta.height);
  const sw = Math.round(meta.width * scale);
  const sh = Math.round(meta.height * scale);
  const left = Math.min(Math.max(0, Math.round(sw * px - W / 2)), sw - W);
  const top = Math.min(Math.max(0, Math.round(sh * py - H / 2)), sh - H);
  const bg = await sharp(join(root, 'public/images/web', `${photo}.jpg`)).resize(sw, sh).extract({ left, top, width: W, height: H }).toBuffer();

  const scrim = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#090b0a" stop-opacity="0.96"/>
        <stop offset="0.5" stop-color="#090b0a" stop-opacity="0.8"/>
        <stop offset="1" stop-color="#090b0a" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="72" y="214" width="56" height="5" rx="2.5" fill="${ACCENT}"/>
  </svg>`);

  const crest = await sharp(join(root, 'public/brand/logo.jpeg'))
    .resize(84, 84)
    .composite([{ input: Buffer.from('<svg width="84" height="84"><circle cx="42" cy="42" r="42"/></svg>'), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const brand = await text('<span foreground="#f1f4f2">Fusion FC</span>', 'InterTight-Bold.ttf', 40, 600);
  const kicker = await text(`<span foreground="${ACCENT}">${esc(label.toUpperCase())}</span>`, 'Inter-Medium.ttf', 24, 700);
  const headline = await text(`<span foreground="#ffffff">${esc(title)}</span>`, 'InterTight-Bold.ttf', 76, 700);

  await sharp(bg)
    .composite([
      { input: scrim },
      { input: crest, left: 72, top: 64 },
      { input: brand.data, left: 172, top: 64 + Math.round((84 - brand.info.height) / 2) },
      { input: kicker.data, left: 72, top: 242 },
      { input: headline.data, left: 72, top: 290 }
    ])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(out, `${name}.jpg`));
  console.log(`og/${name}.jpg`);
}
