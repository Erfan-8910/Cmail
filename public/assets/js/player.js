// Cmail — the audio player (v3.2.2).
// A voice note, a song, a podcast episode that rode in as an attachment —
// it plays right here, in the panel's own accent glass: one slim bar that
// docks to the bottom edge, with a waveform-style seek, speed cycling and
// the honest download beside it. One player for the whole panel; a new
// track takes the seat of the old one.
import { t, lang } from './i18n.js';
import { h, icon, vibrate } from './ui.js';

let el = null;        // the docked bar
let audio = null;     // the element doing the work
let cur = null;       // { url, title, subtitle }
let speedIdx = 1;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

// Persian digits for the timer, the way the rest of the panel speaks
const faNums = (s) => lang === 'fa' ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s);
const clock = (sec) => {
  if (!Number.isFinite(sec)) return faNums('0:00');
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return faNums(`${m}:${String(s).padStart(2, '0')}`);
};

function fmtName(name) {
  return String(name ?? '').replace(/\.[a-z0-9]{1,5}$/i, '');
}

export function isOpen() { return !!el; }

export function closePlayer() {
  try { audio?.pause(); } catch { /* already gone */ }
  audio?.remove(); audio = null;
  el?.classList.remove('is-in');
  const dead = el;
  el = null; cur = null;
  setTimeout(() => dead?.remove(), 320);
  window.removeEventListener('keydown', escClose, true);
}

function escClose(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closePlayer(); }
}

// playTrack({ url, title, subtitle, autoPlay })
export function playTrack(opts) {
  vibrate(6);
  const track = { url: opts.url, title: opts.title ?? '', subtitle: opts.subtitle ?? '' };
  const fresh = !el || cur?.url !== track.url;
  cur = track;

  if (fresh) {
    closePlayer();
    audio = new Audio();
    audio.preload = 'metadata';
    audio.src = track.url;
    build(track);
  } else if (audio) {
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
    syncPlayBtn();
    return;
  }

  const wantsPlay = opts.autoPlay !== false;
  if (wantsPlay) audio.play().catch(() => { /* the tap on the bar starts it */ });
  syncPlayBtn();
}

function build(track) {
  el = h('div', { class: 'cmplayer', role: 'region', 'aria-label': t('playerTitle') });
  document.body.append(el);

  // --- left: the breathing play key (the two glyphs swap with the state) ---
  const playBtn = h('button', { class: 'cmplayer__play', 'aria-label': t('playerPlay') }, icon('play'), icon('pause'));
  playBtn.addEventListener('click', () => {
    if (!audio) return;
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
    vibrate(5);
    syncPlayBtn();
  });
  function syncPlayBtn() {
    if (!playBtn?.isConnected) return;
    playBtn.classList.toggle('is-playing', !!audio && !audio.paused);
  }

  // --- title block ---
  const title = h('div', { class: 'cmplayer__t' },
    h('b', {}, fmtName(track.title)),
    track.subtitle ? h('span', { class: 'cmplayer__sub' }, track.subtitle) : '');

  // --- the seek: a wave-styled progress rail ---
  const rail = h('div', { class: 'cmplayer__rail', role: 'slider', 'aria-label': t('playerSeek'), tabindex: '0' },
    h('span', { class: 'cmplayer__wave' }, ''));
  const fill = h('span', { class: 'cmplayer__fill' }, '');
  rail.append(fill);
  const timeEl = h('span', { class: 'cmplayer__time mono' }, clock(0));

  const seekTo = (clientX) => {
    if (!audio || !Number.isFinite(audio.duration)) return;
    const r = rail.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    audio.currentTime = ratio * audio.duration;
    paint();
  };
  rail.addEventListener('pointerdown', (e) => {
    rail.setPointerCapture?.(e.pointerId);
    seekTo(e.clientX);
    const move = (ev) => seekTo(ev.clientX);
    const up = () => { rail.removeEventListener('pointermove', move); rail.removeEventListener('pointerup', up); };
    rail.addEventListener('pointermove', move);
    rail.addEventListener('pointerup', up);
  });
  rail.addEventListener('keydown', (e) => {
    if (!audio) return;
    if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
  });

  function paint() {
    if (!el?.isConnected) return;
    const d = Number.isFinite(audio.duration) ? audio.duration : 0;
    const p = d > 0 ? Math.min(100, (audio.currentTime / d) * 100) : 0;
    fill.style.width = `${p}%`;
    timeEl.textContent = `${clock(audio.currentTime)} / ${clock(d)}`;
  }
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('play', syncPlayBtn);
  audio.addEventListener('pause', syncPlayBtn);
  audio.addEventListener('ended', () => { syncPlayBtn(); paint(); });

  // --- speed cycling ---
  const speedBtn = h('button', { class: 'cmplayer__speed mono', title: t('playerSpeed'), 'aria-label': t('playerSpeed') }, faNums(`${SPEEDS[speedIdx]}×`));
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    if (audio) audio.playbackRate = SPEEDS[speedIdx];
    speedBtn.textContent = faNums(`${SPEEDS[speedIdx]}×`);
    vibrate(4);
  });

  // --- download: the honest way out of the panel ---
  const dl = h('a', { class: 'icon-btn cmplayer__dl', href: track.url.replace('disp=inline', 'disp=attach'), download: track.title || 'audio', title: t('playerDownload'), 'aria-label': t('playerDownload') }, icon('download'));

  // --- close ---
  const closeBtn = h('button', { class: 'icon-btn', title: t('close'), 'aria-label': t('close'), onclick: () => { closePlayer(); } }, icon('x'));

  el.append(playBtn, title, rail, timeEl, speedBtn, dl, closeBtn);
  requestAnimationFrame(() => el.classList.add('is-in'));
  window.addEventListener('keydown', escClose, true);
  audio.playbackRate = SPEEDS[speedIdx];
  // the track's duration is metadata — an error stays quiet, the bar stands
  audio.addEventListener('error', () => { if (el?.isConnected) paint(); });
}
