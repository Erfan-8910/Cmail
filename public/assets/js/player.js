// Cmail — the audio player (v3.2.2 → v3.2.3).
// A voice note, a song, a podcast episode that rode in as an attachment —
// it plays right here, in the panel's own accent glass. v3.2.3 rebuilds the
// bar the Climind-W way: it RISES from the bottom edge with a spring, an
// aurora breathes behind it while the music plays, a tiny equalizer dances
// with the sound, and the letter's audio files travel as ONE playlist —
// next/prev and the auto-advance walk them all. Speed, volume, seek and the
// honest download stay within one thumb's reach; one player for the whole
// panel, a new track takes the seat of the old one without tearing the bar.
import { t, lang } from './i18n.js';
import { h, icon, vibrate } from './ui.js';

let el = null;        // the docked bar
let audio = null;     // the element doing the work
let cur = null;       // { url, dl, title, subtitle }
let list = null;      // the letter's audio playlist (null → single track)
let idx = -1;         // index inside the playlist
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
  el = null; cur = null; list = null; idx = -1;
  setTimeout(() => dead?.remove(), 320);
  window.removeEventListener('keydown', escClose, true);
}

function escClose(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closePlayer(); }
}

// playTrack({ url, dl, title, subtitle, list, index, autoPlay })
//  · url          the inline stream of THIS tap's file
//  · dl           its forced-download twin (defaults to url with disp swapped)
//  · list/index   the letter's playlist — next/prev ride it when given
export function playTrack(opts) {
  vibrate(6);
  const track = {
    url: opts.url,
    dl: opts.dl ?? (opts.url || '').replace('disp=inline', 'disp=attach'),
    title: opts.title ?? '',
    subtitle: opts.subtitle ?? '',
  };
  const sameBar = !!el && !!audio;
  const sameTrack = sameBar && cur?.url === track.url;

  if (sameTrack) {
    // the seat is already this song — the bar itself is the toggle
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
    syncState();
    return;
  }

  cur = track;
  list = Array.isArray(opts.list) && opts.list.length ? opts.list : null;
  idx = Number.isInteger(opts.index) ? Math.max(0, opts.index ?? 0) : (list ? list.findIndex((x) => x.url === track.url) : -1);
  if (idx < 0 && list) idx = 0;

  if (!sameBar) {
    closePlayer();
    audio = new Audio();
    audio.preload = 'metadata';
    audio.src = track.url;   // v3.2.3 fix — the fresh bar must carry its own source
    build(track);
  } else {
    // a new track takes the old one's seat in place — the bar never blinks
    try { audio.pause(); } catch { /* */ }
    audio.src = track.url;
    audio.load();
    paintTrack();
  }

  const wantsPlay = opts.autoPlay !== false;
  if (wantsPlay) audio.play().catch(() => { /* the tap on the bar starts it */ });
  syncState();
}

// walk the playlist — direction ±1; every sound the letter brought
function stepTrack(dir) {
  if (!list || !audio) return;
  const next = (idx + dir + list.length) % list.length;
  const t2 = list[next];
  if (!t2?.url || !el) return;
  idx = next;
  cur = { url: t2.url, dl: t2.dl ?? t2.url.replace('disp=inline', 'disp=attach'), title: t2.title ?? '', subtitle: cur?.subtitle ?? '' };
  try { audio.pause(); } catch { /* */ }
  audio.src = t2.url;
  audio.load();
  paintTrack();
  audio.play().catch(() => { /* the user can tap play */ });
  vibrate(4);
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
    syncState();
  });

  // --- the dancing equalizer (Climind-W presence, only while it plays) ---
  const eq = h('span', { class: 'cmplayer__eq', 'aria-hidden': 'true' },
    h('i', {}, ''), h('i', {}, ''), h('i', {}, ''), h('i', {}, ''));

  // --- title block: name · whose letter · which track of how many ---
  const title = h('div', { class: 'cmplayer__t' },
    h('b', {}, fmtName(track.title)),
    h('span', { class: 'cmplayer__sub' }, track.subtitle || ''));
  const counter = h('span', { class: 'cmplayer__count mono', style: { display: 'none' } }, '');

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

  // --- playlist steps (visible only when the letter carried more than one sound) ---
  const prevBtn = h('button', { class: 'cmplayer__step', title: t('playerPrev'), 'aria-label': t('playerPrev'), style: { display: 'none' } }, icon('chevron'));
  const nextBtn = h('button', { class: 'cmplayer__step cmplayer__step--next', title: t('playerNext'), 'aria-label': t('playerNext'), style: { display: 'none' } }, icon('chevron', 'rot-180'));
  prevBtn.addEventListener('click', () => stepTrack(-1));
  nextBtn.addEventListener('click', () => stepTrack(1));

  // --- volume: the honest slider (folds away on narrow phones) ---
  const vol = h('input', { class: 'cmplayer__vol', type: 'range', min: '0', max: '1', step: '0.01', value: '1', title: t('playerVolume'), 'aria-label': t('playerVolume') });
  vol.addEventListener('input', () => {
    if (audio) { audio.volume = +vol.value; audio.muted = +vol.value === 0; }
    vol.classList.toggle('is-mute', +vol.value === 0);
  });

  // --- speed cycling ---
  const speedBtn = h('button', { class: 'cmplayer__speed mono', title: t('playerSpeed'), 'aria-label': t('playerSpeed') }, faNums(`${SPEEDS[speedIdx]}×`));
  speedBtn.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    if (audio) audio.playbackRate = SPEEDS[speedIdx];
    speedBtn.textContent = faNums(`${SPEEDS[speedIdx]}×`);
    vibrate(4);
  });

  // --- download: the honest way out of the panel ---
  const dl = h('a', { class: 'icon-btn cmplayer__dl', href: track.dl, download: track.title || 'audio', title: t('playerDownload'), 'aria-label': t('playerDownload') }, icon('download'));

  // --- close ---
  const closeBtn = h('button', { class: 'icon-btn', title: t('close'), 'aria-label': t('close'), onclick: () => { closePlayer(); } }, icon('x'));

  el.append(playBtn, eq, title, counter, rail, timeEl, prevBtn, nextBtn, vol, speedBtn, dl, closeBtn);
  requestAnimationFrame(() => el.classList.add('is-in'));
  window.addEventListener('keydown', escClose, true);
  audio.playbackRate = SPEEDS[speedIdx];

  const paint = () => {
    if (!el?.isConnected) return;
    const d = Number.isFinite(audio.duration) ? audio.duration : 0;
    const p = d > 0 ? Math.min(100, (audio.currentTime / d) * 100) : 0;
    fill.style.width = `${p}%`;
    timeEl.textContent = `${clock(audio.currentTime)} / ${clock(d)}`;
  };
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('durationchange', paint);
  const sync = () => syncState();
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('playing', sync);
  audio.addEventListener('waiting', sync);
  audio.addEventListener('canplay', sync);
  // a song that ends hands the stage to the next one — the playlist walks itself
  audio.addEventListener('ended', () => {
    syncState(); paint();
    if (list && list.length > 1) stepTrack(1);
  });
  // the track's duration is metadata — an error stays quiet, the bar stands
  audio.addEventListener('error', () => { if (el?.isConnected) paint(); });

  paintTrack();
}

// the bar's own mirror of the audio element's state — play glyph, dancing
// equalizer, breathing aurora, buffering pulse, playlist chrome
function syncState() {
  if (!el?.isConnected || !audio) return;
  const playing = !!audio && !audio.paused && !audio.ended;
  const buffering = playing && audio.readyState < 3;
  el.classList.toggle('is-playing', playing);
  el.classList.toggle('is-buffer', buffering);
  const playBtn = el.querySelector('.cmplayer__play');
  if (playBtn) playBtn.classList.toggle('is-playing', playing);
}

// the track-dependent chrome: title, download link, playlist counter + steps
function paintTrack() {
  if (!el?.isConnected) return;
  el.querySelector('.cmplayer__t b').textContent = fmtName(cur?.title ?? '');
  const dl = el.querySelector('.cmplayer__dl');
  if (dl) { dl.href = cur?.dl ?? cur?.url ?? '#'; dl.download = cur?.title || 'audio'; }
  const many = !!list && list.length > 1;
  const counter = el.querySelector('.cmplayer__count');
  if (counter) {
    counter.style.display = many ? '' : 'none';
    if (many) counter.textContent = `${faNums(String(idx + 1))}/${faNums(String(list.length))}`;
  }
  const prevBtn = el.querySelector('.cmplayer__step');
  const nextBtn = el.querySelector('.cmplayer__step--next');
  if (prevBtn && nextBtn) {
    prevBtn.style.display = nextBtn.style.display = many ? '' : 'none';
  }
  fillReset();
}

function fillReset() {
  const fill = el?.querySelector('.cmplayer__fill');
  if (fill) fill.style.width = '0%';
  const timeEl = el?.querySelector('.cmplayer__time');
  if (timeEl) timeEl.textContent = `${clock(0)} / ${clock(0)}`;
}
